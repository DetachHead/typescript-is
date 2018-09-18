import * as ts from 'typescript';
import * as tsutils from 'tsutils';
import { VisitorContext } from './visitor-context';

function createPropertyCheck(accessor: ts.Expression, property: ts.Expression, type: ts.Type, optional: boolean, visitorContext: VisitorContext) {
    const propertyAccessor = ts.createElementAccess(accessor, property);
    const expression = visitType(type, propertyAccessor, visitorContext);
    if (!optional) {
        return expression;
    } else {
        return ts.createBinary(
            ts.createLogicalNot(
                ts.createBinary(
                    property,
                    ts.SyntaxKind.InKeyword,
                    accessor
                )
            ),
            ts.SyntaxKind.BarBarToken,
            expression
        );
    }
}

function visitPropertyName(node: ts.PropertyName, accessor: ts.Expression, visitorContext: VisitorContext): ts.Expression {
    // Identifier | StringLiteral | NumericLiteral | ComputedPropertyName
    if (ts.isIdentifier(node)) {
        return ts.createStringLiteral(node.text);
    } else if (ts.isStringLiteral(node)) {
        return ts.createStringLiteral(node.text);
    } else if (ts.isNumericLiteral(node)) {
        return ts.createStringLiteral(node.text);
    } else {
        return node.expression;
    }
}

function visitPropertySignature(node: ts.PropertySignature, accessor: ts.Expression, visitorContext: VisitorContext) {
    if (node.type === undefined) {
        throw new Error('Visiting property without type.');
    }
    const type = visitorContext.checker.getTypeFromTypeNode(node.type);
    return createPropertyCheck(accessor, visitPropertyName(node.name, accessor, visitorContext), type, node.questionToken !== undefined, visitorContext);
}

function visitDeclaration(node: ts.Declaration, accessor: ts.Expression, visitorContext: VisitorContext): ts.Expression {
    if (ts.isPropertySignature(node)) {
        return visitPropertySignature(node, accessor, visitorContext);
    } else {
        throw new Error('Unsupported declaration kind: ' + node.kind);
    }
}

function visitObjectType(type: ts.ObjectType, accessor: ts.Expression, visitorContext: VisitorContext): ts.Expression {
    const mappers: ((source: ts.Type) => ts.Type | undefined)[] = [];
    if (tsutils.isTypeReference(type)) {
        if (tsutils.isInterfaceType(type.target)) {
            const baseTypes = visitorContext.checker.getBaseTypes(type.target);
            for (const baseType of baseTypes) {
                if (tsutils.isTypeReference(baseType) && baseType.target.typeParameters !== undefined && baseType.typeArguments !== undefined) {
                    const typeParameters = baseType.target.typeParameters;
                    const typeArguments = baseType.typeArguments;
                    mappers.push((source: ts.Type) => {
                        for (let i = 0; i < typeParameters.length; i++) {
                            if (source === typeParameters[i]) {
                                return typeArguments[i];
                            }
                        }
                    });
                }
            }
        }
        if (type.target.typeParameters !== undefined && type.typeArguments !== undefined) {
            const typeParameters = type.target.typeParameters;
            const typeArguments = type.typeArguments;
            mappers.push((source: ts.Type) => {
                for (let i = 0; i < typeParameters.length; i++) {
                    if (source === typeParameters[i]) {
                        return typeArguments[i];
                    }
                }
            });
        }
    }
    const mapper = mappers.reduce<(source: ts.Type) => ts.Type | undefined>((previous, next) => (source: ts.Type) => previous(source) || next(source), () => undefined);
    const conditions: ts.Expression[] = [
        ts.createStrictEquality(
            ts.createTypeOf(accessor),
            ts.createStringLiteral('object')
        ),
        ts.createStrictInequality(
            accessor,
            ts.createNull()
        )
    ];
    visitorContext.typeMapperStack.push(mapper);
    for (const property of visitorContext.checker.getPropertiesOfType(type)) {
        if ('valueDeclaration' in property) {
            conditions.push(visitDeclaration(property.valueDeclaration, accessor, visitorContext));
        } else {
            // Using internal TypeScript API, hacky.
            const propertyType = (property as { type?: ts.Type }).type;
            const propertyName = (property as { name?: string }).name;
            const optional = ((property as ts.Symbol).flags & ts.SymbolFlags.Optional) !== 0;
            if (propertyType !== undefined && propertyName !== undefined) {
                conditions.push(createPropertyCheck(accessor, ts.createStringLiteral(propertyName), propertyType, optional, visitorContext));
            }
        }
    }
    visitorContext.typeMapperStack.pop();
    return conditions.reduce((condition, expression) =>
        ts.createBinary(
            condition,
            ts.SyntaxKind.AmpersandAmpersandToken,
            expression
        )
    );
}

function visitLiteralType(type: ts.LiteralType, accessor: ts.Expression, visitorContext: VisitorContext) {
    if (typeof type.value === 'string') {
        return ts.createStrictEquality(accessor, ts.createStringLiteral(type.value));
    } else if (typeof type.value === 'number') {
        return ts.createStrictEquality(accessor, ts.createNumericLiteral(type.value.toString()));
    } else {
        throw new Error('Type value is expected to be a string or number.');
    }
}

function visitUnionOrIntersectionType(type: ts.Type, accessor: ts.Expression, visitorContext: VisitorContext) {
    let token: ts.SyntaxKind.BarBarToken | ts.SyntaxKind.AmpersandAmpersandToken;
    if (tsutils.isUnionType(type)) {
        token = ts.SyntaxKind.BarBarToken;
    } else if (tsutils.isIntersectionType(type)) {
        token = ts.SyntaxKind.AmpersandAmpersandToken;
    } else {
        throw new Error('UnionOrIntersection type is expected to be a Union or Intersection type.');
    }
    return type.types
        .map((type) => visitType(type, accessor, visitorContext))
        .reduce((condition, expression) => ts.createBinary(condition, token, expression));
}

function visitBooleanLiteral(type: ts.Type, accessor: ts.Expression, visitorContext: VisitorContext) {
    // Using internal TypeScript API, hacky.
    return ts.createStrictEquality(
        accessor,
        (type as { intrinsicName?: string }).intrinsicName === 'true'
            ? ts.createTrue()
            : ts.createFalse()
    );
}

export function visitType(type: ts.Type, accessor: ts.Expression, visitorContext: VisitorContext): ts.Expression {
    if ((ts.TypeFlags.Number & type.flags) !== 0) {
        return ts.createStrictEquality(ts.createTypeOf(accessor), ts.createStringLiteral('number'));
    } else if ((ts.TypeFlags.Boolean & type.flags) !== 0) {
        return ts.createStrictEquality(ts.createTypeOf(accessor), ts.createStringLiteral('boolean'));
    } else if ((ts.TypeFlags.String & type.flags) !== 0) {
        return ts.createStrictEquality(ts.createTypeOf(accessor), ts.createStringLiteral('string'));
    } else if ((ts.TypeFlags.BooleanLiteral & type.flags) !== 0) {
        return visitBooleanLiteral(type, accessor, visitorContext);
    } else if ((ts.TypeFlags.TypeParameter & type.flags) !== 0) {
        const typeMapper = visitorContext.typeMapperStack[visitorContext.typeMapperStack.length - 1];
        if (typeMapper === undefined) {
            throw new Error('Unbound type parameter, missing type mapper.');
        }
        const mappedType = typeMapper(type);
        if (mappedType === undefined) {
            throw new Error('Unbound type parameter, missing type node.');
        }
        return visitType(mappedType, accessor, visitorContext);
    } else if (tsutils.isObjectType(type)) {
        return visitObjectType(type, accessor, visitorContext);
    } else if (tsutils.isLiteralType(type)) {
        return visitLiteralType(type, accessor, visitorContext);
    } else if (tsutils.isUnionOrIntersectionType(type)) {
        return visitUnionOrIntersectionType(type, accessor, visitorContext);
    } else if ((ts.TypeFlags.Never & type.flags) !== 0) {
        return ts.createFalse();
    } else {
        throw new Error('Unsupported type with flags: ' + type.flags);
    }
}
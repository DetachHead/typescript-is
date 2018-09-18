/**
 * Run this file with ts-node in order to debug.
 */

import * as path from 'path';
import * as ts from 'typescript';
import { transformNode } from '../src/transform-inline/transform-node';
import { VisitorContext } from '../src/transform-inline/visitor-context';

const configFilename = path.resolve('tsconfig.json');
const inFile = path.resolve('test', 'case-3.ts');
const content = ts.sys.readFile(configFilename);
if (content === undefined) {
    throw new Error('Could not read config file.');
}
const configFile = ts.parseConfigFileTextToJson(configFilename, content);
const configParseResult = ts.parseJsonConfigFileContent(configFile.config, ts.sys, path.dirname(configFilename), {}, path.basename(configFilename));
configParseResult.options.noEmit = true;
delete configParseResult.options.out;
delete configParseResult.options.outDir;
delete configParseResult.options.outFile;
delete configParseResult.options.declaration;
const program = ts.createProgram([inFile], configParseResult.options);

const visitorContext: VisitorContext = {
    checker: program.getTypeChecker(),
    program,
    typeArgumentsStack: [],
    typeMapperStack: []
};

function visitNodeAndChildren(node: ts.Node) {
    ts.forEachChild(transformNode(node, visitorContext), visitNodeAndChildren);
}

visitNodeAndChildren(program.getSourceFile(inFile)!);
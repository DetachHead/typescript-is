import {is} from '../index';
import * as assert from 'assert';

describe('template literal types', () => {
    describe('union types', () => {
        type Foo = `foo${'bar' | 'baz'}`
        it('true', () => assert.deepStrictEqual(is<Foo>('foobar'), true))
        it('false', () => assert.deepStrictEqual(is<Foo>('barbaz'), false))
    })

    describe('primitives', () => {
        type Foo = `foo${string}bar${number}`
        it('true', () => assert.deepStrictEqual(is<Foo>('foobazbar123'), true))
        it('false', () => assert.deepStrictEqual(is<Foo>('foobazbar123qux'), false))
    })

    it('unions and primitives', () =>
        assert.deepStrictEqual(
            is<`foo${string}${number}bar${1 | 2 | 3}baz${number}asdf`>('foobar1bar2baz123asdf'), true
        )
    )
    describe('key types', () => {
        it('primitives get resolved to strings', () =>
            assert.deepStrictEqual(is<{ [K in `foo${string}`]: any }>({foo: 'bar', baz: 'qux'}), true)
        )
        describe('unions', () => {
            type Foo = { [K in `foo${'bar' | 'baz'}`]: any }
            it('true', () =>
                assert.deepStrictEqual(is<Foo>({foobar: 'bar', foobaz: 'qux'}), true)
            )
            it('false', () =>
                assert.deepStrictEqual(is<Foo>({foo: 'bar', baz: 'qux'}), false)
            )
        })
    })
})

import { gql } from '@apollo/client/core';
import { createOperation } from '@apollo/client/link/utils';
import {  print } from 'graphql';

import { extractKey, getAllArgumentsFromDocument, getVariablesFromArguments, removeVariableDefinitionsFromDocumentIfUnused } from './extractKey';


describe('extractKey', () => {
    it('prefers context.serializationKey if the directive is also supplied', () => {
        const origOperation = createOperation({ serializationKey: 'foo' }, {
            query: gql`
                mutation doThing @serialize(key: "bar") {
                    doThing
                }
            `,
        });
        const { operation, key } = extractKey(origOperation);

        expect(key).toEqual('foo');
        expect(operation).toBe(origOperation);
    });

    it('asserts that the key argument is present', () => {
        expect(() => {
            const origOperation = createOperation(undefined, {
                query: gql`
                    mutation doThing @serialize {
                        doThing
                    }
                `,
            });
            extractKey(origOperation);
        }).toThrow(/@serialize.*key/);
    });

    it('asserts that the key argument is of valid type', () => {
        expect(() => {
            const origOperation = createOperation(undefined, {
                query: gql`
                    mutation doThing @serialize(key: [{foo: "bar"}]) {
                        doThing
                    }
                `,
            });
            extractKey(origOperation);
        }).toThrow(/not allowed in @serialize directive/);
    });

    it('supports empty list as key', () => {
        const origOperation = createOperation(undefined, {
            query: gql`
                mutation doThing @serialize(key: []) {
                    doThing
                }
            `,
        });
        const { operation, key } = extractKey(origOperation);

        expect(key).toEqual('[]');
        expect(operation).not.toBe(origOperation);
    });

    it('supports literal keys via @serialize', () => {
        const origOperation = createOperation(undefined, {
            query: gql`
                mutation doThing @serialize(key: ["bar"]) {
                    doThing
                }
            `,
        });
        const { operation, key } = extractKey(origOperation);

        expect(key).toEqual('["bar"]');
        expect(operation).not.toBe(origOperation);
    });

    it('supports direct variables via @serialize', () => {
        const origOperation = createOperation(undefined, {
            query: gql`
                mutation doThing($var: String) @serialize(key: [$var]) {
                    doThing
                }
            `,
            variables: {
                var: 'bar',
            },
        });
        const { operation, key } = extractKey(origOperation);

        expect(key).toEqual('["bar"]');
        expect(operation).not.toBe(origOperation);
    });

    it('supports all allowed types via @serialize', () => {
        const origOperation = createOperation(undefined, {
            query: gql`
                mutation doThing($var: String) @serialize(key: [$var, true, FOO, 5, 6.7, "abc"]) {
                    doThing
                }
            `,
            variables: {
                var: 'bar',
            },
        });
        const { operation, key } = extractKey(origOperation);

        expect(key).toEqual('["bar",true,"FOO",5,6.7,"abc"]');
        expect(operation).not.toBe(origOperation);
    });

    it('asserts that variable values are supplied', () => {
        expect(() => {
            const origOperation = createOperation(undefined, {
                query: gql`
                    mutation doThing @serialize(key: [$abc]) {
                        doThing
                    }
                `,
            });
            extractKey(origOperation);
        }).toThrow(/\$abc.*@serialize/);
    });

    it('asserts that key is of type List', () => {
        expect(() => {
            const origOperation = createOperation(undefined, {
                query: gql`
                    mutation doThing @serialize(key: "a") {
                        doThing
                    }
                `,
            });
            extractKey(origOperation);
        }).toThrow(/@serialize.*must be of type List/);
    });

    it('removes @serialize from the query document', () => {
        const origOperation = createOperation(undefined, {
            query: gql`
                mutation doThing @serialize(key: ["bar"]) @fizz {
                    doThing
                }
            `,
        });
        const expected = gql`
            mutation doThing @fizz {
                doThing
            }
        `;
        const { operation } = extractKey(origOperation);

        expect(print(operation.query)).toEqual(print(expected));
    });

    it('removes arguments that are only used for @serialize from the query document', () => {
        const origOperation = createOperation(undefined, {
            query: gql`
                mutation doThing($key: String!, $foo: Int) @serialize(key: [$key, $foo]) {
                    doThing(foo: $foo)
                }
            `,
            variables: { key: 'a', foo: 'b' },
        });
        const expected = gql`
            mutation doThing($foo: Int) {
                doThing(foo: $foo)
            }
        `;
        const { operation } = extractKey(origOperation);

        expect(print(operation.query)).toEqual(print(expected));
    });

    it('getAllArgumentsFromDocument', () => {
        const query = gql`
            mutation doThing($id: ID!) @serialize(key: [$key, "4", 3]) {
                doSome
                doThing(a: $id) @connection(key2: $key2)
                ...Foo @obj(o: { a: { in: [$key3] } out: $key4 })
            }

            fragment Foo on Doctor {
                abc(b: $hihi) {
                    nested(c: $nested)
                }
            }
        `;
        const expected = ['key', 'id', 'key2', 'key3', 'key4', 'hihi', 'nested'].sort();
        const vars = getVariablesFromArguments(getAllArgumentsFromDocument(query));

        expect(vars.map(v => v.name.value).sort()).toEqual(expected);
    });

    it('returns the original operation if no serialize directive is present', () => {
        const origOperation = createOperation({}, {
            query: gql`
                mutation doThing {
                    doThing
                }
            `,
        });
        const { operation, key } = extractKey(origOperation);

        expect(key).toEqual(undefined);
        expect(operation).toBe(origOperation);
    });

    it('caches transformed documents', () => {
        const query = gql`
            mutation something($var: String) @serialize(key: [$var]) {
                doThing
            }
        `;
        const firstOperation = createOperation(undefined, {
            query,
            variables: {
                var: 'bar',
            },
        });
        const secondOperation = createOperation(undefined, {
            query,
            variables: {
                var: 'baz',
            },
        });
        const { operation: op1, key: key1 } = extractKey(firstOperation);
        const { operation: op2, key: key2 } = extractKey(secondOperation);

        expect(key1).toEqual('["bar"]');
        expect(key2).toEqual('["baz"]');
        expect(op1.query).toBe(op2.query);
    });
});

describe('removeVariableDefinitionsFromDocumentIfUnused', () => {
    it('removes variables from definition that are not used', () => {
        const query = gql`
            mutation doThing($id: ID!, $key: Int, $key2: String, $key3: ENUMx) {
                something
            }
        `;
        const expected = gql`
            mutation doThing {
                something
            }
        `;
        const keys = ['key', 'id', 'key2', 'key3', 'key4', 'hihi', 'nested'];
        removeVariableDefinitionsFromDocumentIfUnused(keys, query);

        expect(print(query)).toEqual(print(expected));
    });

    it('does not remove variable definitions for variables that are used', () => {
        const query = gql`
            mutation doThing($bool: Booolean!, $id: ID!, $key2: String, $hihi: Int, $nested: ENUM1) {
                doSome
                doThing(a: $id) @connection(key2: $key2)
                ...Foo @skip(if: $bool)
            }

            fragment Foo on Doctor {
                abc(b: $hihi) {
                    nested(c: $nested)
                }
            }
        `;
        const keys = ['key', 'id', 'key2', 'key3', 'key4', 'hihi', 'nested'];
        removeVariableDefinitionsFromDocumentIfUnused(keys, query);

        expect(print(query)).toEqual(print(query));
    });
});

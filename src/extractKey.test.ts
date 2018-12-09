import { createOperation } from 'apollo-link';
import gql from 'graphql-tag';
import { OperationDefinitionNode, print } from 'graphql';

import { extractKey } from './extractKey';

import { removeDirectivesFromDocument, checkDocument } from 'apollo-utilities';

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
        const { operation, key } = extractKey(origOperation);

        const operationNode = operation.query.definitions[0] as OperationDefinitionNode;
        expect(operationNode.directives.length).toEqual(1);
        expect(operationNode.directives[0].name.value).toEqual('fizz');
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

    // Check that it's caching operations
});

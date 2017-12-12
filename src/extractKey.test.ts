import { createOperation } from 'apollo-link';
import gql from 'graphql-tag';
import { OperationDefinitionNode } from 'graphql';

import { extractKey } from './extractKey';

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
            const origOperation = createOperation(null, {
                query: gql`
                    mutation doThing @serialize {
                        doThing
                    }
                `,
            });
            extractKey(origOperation);
        }).toThrow(/@serialize.*key/);
    });

    it('asserts that the key argument is a string or variable', () => {
        expect(() => {
            const origOperation = createOperation(null, {
                query: gql`
                    mutation doThing @serialize(key: 123) {
                        doThing
                    }
                `,
            });
            extractKey(origOperation);
        }).toThrow(/@serialize.*key/);
    });

    it('supports literal keys via @serialize', () => {
        const origOperation = createOperation(null, {
            query: gql`
                mutation doThing @serialize(key: "bar") {
                    doThing
                }
            `,
        });
        const { operation, key } = extractKey(origOperation);

        expect(key).toEqual('bar');
        expect(operation).not.toBe(origOperation);
    });

    it('supports direct variables via @serialize', () => {
        const origOperation = createOperation(null, {
            query: gql`
                mutation doThing($var: String) @serialize(key: $var) {
                    doThing
                }
            `,
            variables: {
                var: 'bar',
            },
        });
        const { operation, key } = extractKey(origOperation);

        expect(key).toEqual('bar');
        expect(operation).not.toBe(origOperation);
    });

    it('removes @serialize from the query document', () => {
        const origOperation = createOperation(null, {
            query: gql`
                mutation doThing @serialize(key: "bar") @fizz {
                    doThing
                }
            `,
        });
        const { operation, key } = extractKey(origOperation);

        const operationNode = operation.query.definitions[0] as OperationDefinitionNode;
        expect(operationNode.directives.length).toEqual(1);
        expect(operationNode.directives[0].name.value).toEqual('fizz');
    });

    it('interpolates variables within a string', () => {
        const origOperation = createOperation(null, {
            query: gql`
                mutation doThing($id: Integer, $oid: String) @serialize(key: "thing:{{id}}:{{oid}}") @fizz {
                    doThing
                }
            `,
            variables: {
                id: 123,
                oid: 'foo',
            },
        });
        const { operation, key } = extractKey(origOperation);

        expect(key).toEqual('thing:123:foo');
        expect(operation).not.toBe(origOperation);
    });
});

import { createOperation, Operation } from 'apollo-link';
import {
    OperationDefinitionNode,
    DirectiveNode,
    ListValueNode,
    ValueNode,
} from 'graphql';

import {
    checkDocument,
    removeDirectivesFromDocument,
    cloneDeep,
    getOperationDefinitionOrDie,
    getOperationDefinition,
} from 'apollo-utilities';

const DIRECTIVE_NAME = 'serialize';

export function extractKey(operation: Operation): { operation: Operation, key?: string } {
    const { serializationKey } = operation.getContext();
    if (serializationKey) {
        return { operation, key: serializationKey };
    }
    // // Explicit keys in the link context win out.
    // const { serializationKey } = operation.getContext();
    // if (serializationKey) {
    //     return { operation, key: serializationKey };
    // }

    // START CACHE by operation.query!!

    checkDocument(operation.query);

    const directive = extractDirective(getOperationDefinitionOrDie(operation.query), DIRECTIVE_NAME);
    if (!directive) {
        return { operation };
    }
    const argument = directive.arguments.find(d => d.name.value === 'key');
    if (!argument) {
        throw new Error(`The @${DIRECTIVE_NAME} directive requires a 'key' argument`);
    }
    if (argument.value.kind !== 'ListValue') {
        throw new Error(`The @${DIRECTIVE_NAME} directive's 'key' argument must be of type List, got ${argument.kind}`);
    }

    // Clone the document to remove the @serialize directive
    const docWithoutDirective = cloneDeep(operation.query);
    const operationDefinition = getOperationDefinition(operation.query);
    operationDefinition.directives = operationDefinition.directives.filter(node => node.name.value !== DIRECTIVE_NAME);

    // END cached part.

    const key = materializeKey(argument.value, operation.variables);

    // Pass through the operation, with the directive removed so that the server
    // doesn't see it.
    // We also remove any arguments from the operation definition that are unused
    // after the removal of the directive.
    const newOperation = createOperation(operation.getContext(), {
        ...operation,
        query: removeDirectivesFromDocument([{ name: DIRECTIVE_NAME }], operation.query),
    });

    return { operation: newOperation, key };
}

function extractDirective(query: OperationDefinitionNode, directiveName: string): DirectiveNode | undefined {
    return query.directives.filter(node => node.name.value === directiveName)[0];
}

export function materializeKey(argumentList: ListValueNode, variables?: Record<string, any>): string {
    return JSON.stringify(argumentList.values.map(val => valueForArgument(val, variables)));
}

export function valueForArgument(value: ValueNode, variables?: Record<string, any>): string | number | boolean {
    if (value.kind === 'Variable') {
        return getVariableOrDie(variables, value.name.value);
    }
    if (value.kind === 'IntValue') {
        return parseInt(value.value, 10);
    }
    if (value.kind === 'FloatValue') {
        return parseFloat(value.value);
    }
    if (value.kind === 'StringValue' || value.kind === 'BooleanValue' || value.kind === 'EnumValue') {
        return value.value;
    }
    throw new Error(`Argument of type ${value.kind} is not allowed in @${DIRECTIVE_NAME} directive`);
}

export function getVariableOrDie(variables: Record<string, any> | undefined, name: string): any {
    if (!variables || !(name in variables)) {
        throw new Error(`No value supplied for variable $${name} used in @serialize key`);
    }
    return variables[name];
}

import { createOperation, Operation } from 'apollo-link';
import { DirectiveNode, ArgumentNode } from 'graphql';

import deepUpdate = require('deep-update');

export function extractKey(operation: Operation): { operation: Operation, key?: string } {
    // Explicit keys in the link context win out.
    const { serializationKey } = operation.getContext();
    if (serializationKey) {
        return { operation, key: serializationKey };
    }

    const { directive, path } = extractDirective(operation);
    if (!directive) {
        return { operation };
    }
    const argument = directive.arguments.find(d => d.name.value === 'key');
    if (!argument) {
        throw new Error(`The @serialize directive requires a 'key' argument`);
    }
    let key = valueForArgument(argument, operation.variables);
    // Replace any {{variable}}s with their value.
    key = key.replace(/\{\{([^\}]+)\}\}/g, (_substring, name) => {
        return getVariableOrDie(operation.variables, name);
    });

    // Pass through the operation, with the directive removed so that the server
    // doesn't see it.
    const finalIndex = path.pop();
    const newOperation = createOperation(operation.getContext(), {
        ...operation as any,
        query: deepUpdate(operation.query, path, {$splice: [[finalIndex, 1]]}),
    });

    return { operation: newOperation, key };
}

function extractDirective({ query, operationName }: Operation): { directive?: DirectiveNode, path?: string[] } {
    const path: string[] = [];

    // First, find the operation definition
    let operationNode;
    for (let i = 0; i < query.definitions.length; i++) {
        const node = query.definitions[i];
        if (node.kind !== 'OperationDefinition') {
            continue;
        }
        if (!operationName || node.name.value === operationName) {
            operationNode = node;
            path.push('definitions', `${i}`);
            break;
        }
    }

    // Then, the directive itself.
    for (let i = 0; i < operationNode.directives.length; i++) {
        const node = operationNode.directives[i];
        if (node.name.value === 'serialize') {
            path.push('directives', `${i}`);
            return { directive: node, path };
        }
    }

    return {};
}

export function valueForArgument({ value }: ArgumentNode, variables?: Record<string, any>): string {
    if (value.kind === 'Variable') {
        return getVariableOrDie(variables, value.name.value);
    }
    if (value.kind !== 'StringValue') {
        throw new Error(`values for @serialize(key:) must be strings or variables`);
    }

    return value.value;
}

export function getVariableOrDie(variables: Record<string, any> | undefined, name: string): any {
    if (!variables || !(name in variables)) {
        throw new Error(`Expected $${name} to exist for @serialize`);
    }
    return variables[name];
}

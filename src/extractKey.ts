import { createOperation, Operation } from 'apollo-link';
import {
    OperationDefinitionNode,
    DirectiveNode,
    ListValueNode,
    ValueNode,
    DocumentNode,
    print,
} from 'graphql';

import {
    checkDocument,
    removeDirectivesFromDocument,
    cloneDeep,
    getOperationDefinitionOrDie,
    getOperationDefinition,
} from 'apollo-utilities';

const DIRECTIVE_NAME = 'serialize';

type DocumentCache = Map<DocumentNode, { doc: DocumentNode, args: ListValueNode }>;

const documentCache: DocumentCache = new Map();
function extractDirectiveArguments(doc: DocumentNode, cache: DocumentCache = documentCache): {doc: DocumentNode, args?: ListValueNode } {
    if (cache.has(doc)) {
        // We cache the transformed document to avoid re-parsing and transforming the same document
        // over and over again. The cache relies on referential equality between documents. If using
        // graphql-tag this is a given, so it should work out of the box in most cases.
        return cache.get(doc);
    }

    checkDocument(doc);

    const directive = extractDirective(getOperationDefinitionOrDie(doc), DIRECTIVE_NAME);
    if (!directive) {
        return { doc };
    }
    const argument = directive.arguments.find(d => d.name.value === 'key');
    if (!argument) {
        throw new Error(`The @${DIRECTIVE_NAME} directive requires a 'key' argument`);
    }
    if (argument.value.kind !== 'ListValue') {
        throw new Error(`The @${DIRECTIVE_NAME} directive's 'key' argument must be of type List, got ${argument.kind}`);
    }

    // Clone the document to remove the @serialize directive
    // removeDirectivesFromDocument currently doesn't remove them from operation definitions,
    // so we do it ourselves here. We still call removeDirectivesFromDocuments to remove arguments
    // that are unused after having removed the @serialize directive
    const docWithoutDirective = cloneDeep(doc);
    const operationDefinition = getOperationDefinition(docWithoutDirective);
    operationDefinition.directives = operationDefinition.directives.filter(node => node.name.value !== DIRECTIVE_NAME);

    const ret = {
        doc: removeDirectivesFromDocument([{ name: DIRECTIVE_NAME }], docWithoutDirective),
        args: argument.value,
    };
    cache.set(doc, ret);
    return ret;
}

export function extractKey(operation: Operation): { operation: Operation, key?: string } {
    const { serializationKey } = operation.getContext();
    if (serializationKey) {
        return { operation, key: serializationKey };
    }

    const { doc, args } = extractDirectiveArguments(operation.query);

    if (!args) {
        return { operation };
    }

    const key = materializeKey(args, operation.variables);

    // Pass through the operation, with the directive removed so that the server
    // doesn't see it.
    // We also remove any arguments from the operation definition that are unused
    // after the removal of the directive.
    const newOperation = createOperation(operation.getContext(), {
        ...operation,
        query: doc,
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

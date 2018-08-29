import {
    ApolloLink,
    Observable,
    Observer,
    Operation,
    NextLink,
    FetchResult,
} from 'apollo-link';

export interface OperationQueueEntry {
    operation: Operation;
    forward: NextLink;
    observer: Observer<FetchResult>;
    subscription?: { unsubscribe: () => void };
}

// Serialize queries with the same context.serializationKey, meaning that
// all previous queries must complete for the next query with the same
// context.serializationKey to be started.
export default class SerializingLink extends ApolloLink {
    private opQueues: { [key: string]: OperationQueueEntry[] } = {};

    public request(operation: Operation, forward: NextLink ) {
        if (!operation.getContext().serializationKey) {
            return forward(operation);
        }
        const key = operation.getContext().serializationKey;
        return new Observable(observer => {
            this.enqueue(key, { operation, forward, observer });

            return () => {
               this.cancelOp(key, { operation, forward, observer });
            };
        });
    }
    // Remove the first element from the queue and start the next operation
    private dequeue = (key: string, observer: Observer<FetchResult>) => {
        if (!this.opQueues[key]) {
            return;
        }
        this.opQueues[key] = this.opQueues[key].filter(op => op.observer !== observer);
        this.startFirstOpIfNotStarted(key);
        // console.log('dequeue', key, 'queue length', this.opQueues[key].length);
    }

    // Add an operation to the end of the queue. If it is the first operation in the queue, start it.
    private enqueue = (key: string, entry: OperationQueueEntry) => {
        if (!this.opQueues[key]) {
            this.opQueues[key] = [];
        }
        this.opQueues[key].push(entry);
        if (this.opQueues[key].length === 1) {
            this.startFirstOpIfNotStarted(key);
        }
        // console.log('enqueue', key, 'queue length', this.opQueues[key].length);
    }

    // Cancel the operation by removing it from the queue and unsubscribing if it is currently in progress.
    private cancelOp = (key: string, { operation, forward, observer }: OperationQueueEntry) => {
        if (!this.opQueues[key]) {
            return;
        }
        this.opQueues[key] = this.opQueues[key].filter(entry => {
            if (entry.operation === operation && entry.forward === forward && entry.observer === observer) {
                if (entry.subscription) {
                    entry.subscription.unsubscribe();
                }
                return false;
            }
            return true;
        });
        this.startFirstOpIfNotStarted(key);
    }

    // Start the first operation in the queue if it hasn't been started yet
    private startFirstOpIfNotStarted = (key: string) => {
        // At this point, the queue always exists, but it may not have any elements
        // If it has no elements, we free up the memory it was using.
        if (this.opQueues[key].length === 0) {
            delete this.opQueues[key];
            return;
        }
        const { operation, forward, observer, subscription } = this.opQueues[key][0];
        if (subscription) { return; }
        this.opQueues[key][0].subscription = forward(operation).subscribe({
            next: (v) => observer.next && observer.next(v),
            error: (e: Error) => {
                if (observer.error) { observer.error(e); }
                this.dequeue(key, observer);
            },
            complete: () => {
                if (observer.complete) { observer.complete(); }
                this.dequeue(key, observer);
            },
        });
    }
}

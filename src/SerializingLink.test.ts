import {
  ApolloLink,
  execute,
  from,
  gql,
  GraphQLRequest,
} from "@apollo/client/core";
import SerializingLink from "./SerializingLink";
import {
  assertObservableSequence,
  mergeObservables,
  ObservableEvent,
  TestSequenceLink,
  toResultValue,
  Unsubscribable,
} from "./TestUtils";

// TODO: Reduce test boilerplate code
// TODO: Consolidate test utilities
describe("SerializingLink", () => {
  let link: ApolloLink;
  let testLink: TestSequenceLink;

  const testResponse = {
    data: {
      hello: "World",
    },
  };

  const testSequence = [
    {
      type: "next",
      value: testResponse,
    },
    {
      type: "complete",
    },
  ];

  const op: GraphQLRequest = {
    query: gql`
      {
        hello
      }
    `,
    context: {
      serializationKey: "key1",
      testSequence,
    },
  };

  beforeEach(() => {
    jest.useFakeTimers();
    testLink = new TestSequenceLink();
    link = from([new SerializingLink(), testLink]);
  });

  it("forwards the operation", () => {
    return new Promise<void>((resolve, reject) => {
      execute(link, op).subscribe({
        next: (data) => undefined,
        error: (error) => reject(error),
        complete: () => {
          expect(testLink.operations.length).toBe(1);
          expect(testLink.operations[0].query).toEqual(op.query);
          resolve();
        },
      });
      jest.runAllTimers();
    });
  });
  it("forwards the operation if context.serializationKey is not defined", () => {
    const opWithoutKey: GraphQLRequest = {
      query: gql`
        {
          hello
        }
      `,
      context: {
        testSequence,
      },
    };
    return new Promise<void>((resolve, reject) => {
      execute(link, opWithoutKey).subscribe({
        next: (data) => undefined,
        error: (error) => reject(error),
        complete: () => {
          expect(testLink.operations.length).toBe(1);
          expect(testLink.operations[0].query).toEqual(op.query);
          resolve();
        },
      });
      jest.runAllTimers();
    });
  });
  it("calls next and complete as expected", () => {
    return Promise.resolve(
      assertObservableSequence(
        execute(link, op),
        [{ type: "next", value: testResponse }, { type: "complete" }],
        () => jest.runAllTimers()
      )
    );
  });
  it("passes through errors", () => {
    const testError = new Error("Hello darkness my old friend");
    const opWithError: GraphQLRequest = {
      query: gql`
        {
          hello
        }
      `,
      context: {
        serializationKey: "key1",
        testSequence: [{ type: "error", value: testError }],
      },
    };
    return Promise.resolve(
      assertObservableSequence(
        execute(link, opWithError),
        [{ type: "error", value: testError }],
        () => jest.runAllTimers()
      )
    );
  });
  it("does not block queries with different serializationKey", () => {
    const ts1: ObservableEvent[] = [
      {
        type: "next",
        delay: 2,
        value: { data: { q1: "one" } },
      },
      {
        type: "complete",
        delay: 2,
      },
    ];
    const op1: GraphQLRequest = {
      query: gql`
        {
          q1
        }
      `,
      context: {
        serializationKey: "1",
        testSequence: ts1,
      },
    };
    const ts2: ObservableEvent[] = [
      {
        type: "next",
        delay: 1,
        value: { data: { q2: "two" } },
      },
      {
        type: "complete",
        delay: 1,
      },
    ];
    const op2: GraphQLRequest = {
      query: gql`
        {
          q2
        }
      `,
      context: {
        serializationKey: "2",
        testSequence: ts2,
      },
    };
    return Promise.resolve(
      assertObservableSequence(
        mergeObservables(execute(link, op1), execute(link, op2)),
        [toResultValue(ts2[0]), ...ts1.map(toResultValue)],
        () => jest.runAllTimers()
      )
    );
  });

  it("blocks queries with identical serializationKey", () => {
    // make two queries with same key
    // first query returns slower than second, but runs first
    // make sure second query never called.
    const ts1: ObservableEvent[] = [
      {
        type: "next",
        delay: 2,
        value: { data: { q1: "one" } },
      },
      {
        type: "complete",
        delay: 2,
      },
    ];
    const op1: GraphQLRequest = {
      query: gql`
        {
          q1
        }
      `,
      context: {
        serializationKey: "A",
        testSequence: ts1,
      },
    };
    const ts2: ObservableEvent[] = [
      {
        type: "next",
        delay: 1,
        value: { data: { q2: "two" } },
      },
      {
        type: "complete",
        delay: 1,
      },
    ];
    const op2: GraphQLRequest = {
      query: gql`
        {
          q2
        }
      `,
      context: {
        serializationKey: "A",
        testSequence: ts2,
      },
    };
    return Promise.resolve(
      assertObservableSequence(
        mergeObservables(execute(link, op1), execute(link, op2)),
        [toResultValue(ts1[0]), ...ts2.map(toResultValue)],
        () => jest.runAllTimers()
      )
    );
  });

  it("unblocks queue if first query errors", () => {
    // two with same key
    // first query returns one result, then errors.
    // second query must run (after first)
    const ts1: ObservableEvent[] = [
      {
        type: "next",
        delay: 2,
        value: { data: { q1: "one" } },
      },
      {
        type: "error",
        value: new Error("oops"),
        delay: 2,
      },
    ];
    const op1: GraphQLRequest = {
      query: gql`
        {
          q1
        }
      `,
      context: {
        serializationKey: "A",
        testSequence: ts1,
      },
    };
    const ts2: ObservableEvent[] = [
      {
        type: "next",
        delay: 1,
        value: { data: { q2: "two" } },
      },
      {
        type: "complete",
        delay: 1,
      },
    ];
    const op2: GraphQLRequest = {
      query: gql`
        {
          q2
        }
      `,
      context: {
        serializationKey: "A",
        testSequence: ts2,
      },
    };
    return Promise.all([
      Promise.resolve(
        assertObservableSequence(
          execute(link, op1),
          [...ts1.map(toResultValue)],
          () => jest.runAllTimers()
        )
      ),
      Promise.resolve(
        assertObservableSequence(
          execute(link, op2),
          [...ts2.map(toResultValue)],
          () => jest.runAllTimers()
        )
      ),
    ]);
  });

  it("unblocks queue if first query is unsubscribed from", () => {
    // two with same key
    // first query never returns result, is unsubscribed from soon after starting
    // second query must run
    const ts1: ObservableEvent[] = [
      {
        type: "next",
        delay: 2,
        value: { data: { q1: "one" } },
      },
    ];
    const op1: GraphQLRequest = {
      query: gql`
        {
          q1
        }
      `,
      operationName: "op1",
      context: {
        serializationKey: "A",
        testSequence: ts1,
      },
    };
    const ts2: ObservableEvent[] = [
      {
        type: "next",
        delay: 1,
        value: { data: { q2: "two" } },
      },
      {
        type: "complete",
        delay: 1,
      },
    ];
    const op2: GraphQLRequest = {
      query: gql`
        {
          q2
        }
      `,
      operationName: "op2",
      context: {
        serializationKey: "A",
        testSequence: ts2,
      },
    };
    return Promise.all([
      Promise.resolve(
        assertObservableSequence(
          execute(link, op1),
          [...ts1.map(toResultValue)],
          (sub: Unsubscribable) => {
            setTimeout(() => sub.unsubscribe(), 5);
            jest.runAllTimers();
          }
        )
      ),
      Promise.resolve(
        assertObservableSequence(
          execute(link, op2),
          [...ts2.map(toResultValue)],
          () => jest.runAllTimers()
        )
      ),
    ]);
  });
  it("only enqueue one subsequent query on complete of first", () => {
    // make three queries with same key
    // second query returns slower than thirds, but runs first
    // make sure third query completes after second
    const ts1: ObservableEvent[] = [
      {
        type: "next",
        delay: 2,
        value: { data: { q1: "one" } },
      },
      {
        type: "complete",
        delay: 2,
      },
    ];
    const op1: GraphQLRequest = {
      query: gql`
        {
          q1
        }
      `,
      context: {
        serializationKey: "A",
        testSequence: ts1,
      },
    };
    const ts2: ObservableEvent[] = [
      {
        type: "next",
        delay: 3,
        value: { data: { q2: "two" } },
      },
      {
        type: "complete",
        delay: 3,
      },
    ];
    const op2: GraphQLRequest = {
      query: gql`
        {
          q3
        }
      `,
      context: {
        serializationKey: "A",
        testSequence: ts2,
      },
    };
    const ts3: ObservableEvent[] = [
      {
        type: "next",
        delay: 1,
        value: { data: { q3: "three" } },
      },
      {
        type: "complete",
        delay: 1,
      },
    ];
    const op3: GraphQLRequest = {
      query: gql`
        {
          q3
        }
      `,
      context: {
        serializationKey: "A",
        testSequence: ts3,
      },
    };
    return Promise.resolve(
      assertObservableSequence(
        mergeObservables(
          execute(link, op1),
          execute(link, op2),
          execute(link, op3)
        ),
        [
          toResultValue(ts1[0]),
          toResultValue(ts2[0]),
          ...ts3.map(toResultValue),
        ],
        () => jest.runAllTimers()
      )
    );
  });
  // TODO: Test unsubscribing from the second op
  // TODO?: Test subscribers without error, next or complete function?
  // or maybe those are just wrong types?
});

# apollo-link-serialize

[![npm version](https://badge.fury.io/js/apollo-link-serialize.svg)](https://badge.fury.io/js/apollo-link-serialize)
[![Build Status](https://travis-ci.org/helfer/apollo-link-serialize.svg?branch=master)](https://travis-ci.org/helfer/apollo-link-serialize)
[![codecov](https://codecov.io/gh/helfer/apollo-link-serialize/branch/master/graph/badge.svg)](https://codecov.io/gh/helfer/apollo-link-serialize)

An Apollo Link that serializes requests by key, making sure that they execute in the exact order in which they were submitted.

### Motivation

When sending requests to the server using HTTP there are no guarantees in which order requests will reach the server. Worse yet, when using a RetryLink, it is very likely that requests will get reordered in case of transient network or server errors. For requests where the order matters, you can use apollo-link-serialize to guarantee that they are executed in the exact order in which they were submitted. If we have requests A and B, request B will not be forwarded by the serialization link until request A has completed or errored.

Note: If combining apollo-link-serialize with apollo-link-retry, make sure the retry link is closer to the network stack than the serializing link. If it isn't, requests may get reordered before they reach the serializing link.

Let's take a simple example: A page that lets the user input two values, their favorite color and their favorite number (yeah, I know, but it's just an example, so bear with me, okay!). When the user changes these values, they get sent to the server, and the server simply updates a database entry for that user with the new value. In this case, the order in which the updates reach the server is highly significant. If the user first sets the favorite color to "Red" and then to "Blue", the update setting it to "Blue" should arrive after the update setting it to "Red", otherwise the value that sticks will be "Red" instead of "Blue"! Same for the favorite number: The last update that the server sees has to be the last update the user made. apollo-link-serialize can help you make sure that that happens by not sending new requests until previous ones have completed.

Note that in the example above, the ordering between requests for favorite color and favorite number don't matter, so ordering only needs to be preserved between requests of the same type. Preserving ordering between unrelated requests would be wasteful and increase latency, so apollo-link-serialize lets you specify which requests to serialize behind which other requests by specifying `{ context: { serializationKey: 'key here' } }`. In the example above, we could use `serializationKey: 'favoriteColor'` and `serializationKey: 'favoriteNumber'`.

Requests whose context does not contain `serializationKey` will be passed through to the next link and not serialized.

### Install

```sh
npm install apollo-link-serialize
```

or

```
yarn add apollo-link-serialize
```

### Usage

You can indicate requests that should be serialized by providing a serialization key.  All requests with the same serialization key will be queued behind one another in the order they are executed.

The key can be expressed via the `@serialize(key: …)` directive:

```graphql
# The key can be a literal string…
mutation favoriteIsRed @serialize(key: "favoriteColor") {
    setFavoriteColor(color: "RED)
}
```

```graphql
# …or it can be a variable in the operation…
mutation upvotePost($id: ID!) @serialize(key: $id) {
    post(id: $id) {
        addVote
    }
}
```

```graphql
# …and finally, it also supports interpolation:
mutation upvotePost($id: ID!) @serialize(key: "post:{{id}}") {
    post(id: $id) {
        addVote
    }
}
```

Additionally, you can also pass an explicit serialization key in the operation's context:

```js
link.execute({
    query: gql`mutation { setFavoriteColor(color: "RED") }`,
    context: {
        serializationKey: 'favoriteColor',
    },
});
```

Requests without a serialization key are executed in parallel.  Similarly, requests with differing keys are executed in parallel with one another.

### Example

```js
import { ApolloLink } from 'apollo-link';
import { HttpLink } from 'apollo-link-http';
import { RetryLink } from 'apollo-link-retry';
import gql from 'graphql-tag';

import SerializingLink from 'apollo-link-serialize';

this.link = ApolloLink.from([
    new SerializingLink(),
    new HttpLink({ uri: URI_TO_YOUR_GRAPHQL_SERVER }),
]);

// Assume the server/network delay for this request is 100ms
const opColor = {
    query: gql`
        mutation favoriteIsRed @serialize(key: "favoriteColor") {
            setFavoriteColor(color: "RED")
        }
    `,
};

// Assume the server/network delay for this request is 10ms
const opColor2 = {
    query: gql`
        mutation favoriteIsBlue @serialize(key: "favoriteColor") {
            setFavoriteColor(color: "BLUE")
        }
    `,
};

// Assume the server/network delay for this request is 50ms
const opNumber = {
    query: gql`
        mutation favoriteIsSeven @serialize(key: "favoriteNumber") {
            setFavoriteNumber(number: 7)
        }
    `,
};

link.execute(opColor).subscribe({
    next(response) { console.log(response.data.setFavoriteColor); },
});
link.execute(opColor2).subscribe({
    next(response) { console.log(response.data.setFavoriteColor); },
});
link.execute(opNumber).subscribe({
    next(response) { console.log(response.data.setFavoriteNumber); },
});

// Assuming the server/network delays mentioned above, this code will output:
// 7 (after 50ms)
// RED (after 100ms)
// BLUE (after 110ms)
```

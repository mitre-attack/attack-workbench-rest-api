I need your help solving a critical issue in the source code for the ATT&CK Workbench REST API application: All of our regression tests in `app/tests/` must be run with ATT&CK Data Model (ADM) validation turned off.

```typescript
describe('Techniques Convert API', function () {
  let app;
  let passportCookie;

  before(async function () {
    await database.initializeConnection();
    await databaseConfiguration.checkSystemConfiguration();

    config.validateRequests.withAttackDataModel = false; // <-- this is the key line
    config.validateRequests.withOpenApi = false;

    app = await require('../../../index').initializeApp();
    passportCookie = await login.loginAnonymous(app);
  });
```

The ADM refers to a JavaScript library, `@mitre-attack/attack-data-model`, maintained by us at MITRE, that provides a set of Zod schemas for validating STIX objects against the ATT&CK Data Model. It is the source of truth for what constitutes a valid ATT&CK STIX object, and it was recently integrated into the REST API's request validation logic to ensure that all incoming requests are compliant with the ADM validation rules.

The reason that the regression tests must be run with ADM disabled is because the ADM makes the validation of requests significantly stricter than it was before, and many of our existing regression tests were not designed with this level of strictness in mind. Most, if not all, of the regression tests in `app/tests/` build request bodies from manually constructed STIX objects, most of which do not pass the ADM validation rules. This is not necessarily a bad thing, as it allows us to test the API's behavior with a wider variety of inputs, including those that may not be fully compliant with the ADM. However, it does mean that we cannot run these tests with ADM validation turned on without first updating them to ensure that their request bodies are compliant with the ADM.

The way I see it, we have three solutions:

1. Update all existing regression tests in `app/tests/` to ensure that their request bodies are compliant with the ADM. This would involve reviewing each test case, identifying any non-compliant STIX objects, and modifying them to adhere to the ADM validation rules. While this approach would allow us to run all tests with ADM validation turned on, it would require a significant amount of time and effort, especially if there are many tests that need to be updated.

2. Create a separate set of regression tests that are specifically designed to be compliant with the ADM. This would allow us to maintain our existing regression tests as they are, while also having a new set of tests that can be run with ADM validation turned on. This approach would require less effort than updating all existing tests, but it would also mean that we have two sets of regression tests to maintain, which could lead to confusion and duplication of effort in the long run.

3. Implement a synthetic data generator that can create compliant STIX objects for use in our regression tests. This approach is appealing because it presents an opportunity to expose an API for generating fake STIX objects directly from the `@mitre-attack/attack-data-model` library, which could be useful for other purposes beyond just our regression tests. Each regression test would still need to be updated to use the synthetic data generator, but this would likely be less time-consuming than manually updating each test case to use compliant, mock data. Additionally, this approach would likely save time in the long run, as it would allow us to easily generate compliant STIX objects for any future tests we may need to create, without having to manually construct them each time.

Constraints & Issues:

The ADM exposes a set of Zod schemas that define the structure and validation rules for STIX objects. However, these on their own are insufficient for validating the request bodies in our regression tests. Importantly, the REST API is more permissiveness than the ADM, allowing the user to omit certain fields that are required the ADM, specifically when the object is flagged as "work-in-progress":

```typescript
const baseTechniqueData = {
  workspace: {
    workflow: {
      state: 'work-in-progress',
    },
  },
  stix: {
    name: 'convert-test-technique',
    type: 'attack-pattern',
    description: 'A technique for conversion tests.',
    object_marking_refs: ['marking-definition--fa42a846-8d90-4e51-bc29-71d5b4802168'],
    created_by_ref: 'identity--c78cb6e5-0c4b-4611-8297-d1b8b55e40b5',
    kill_chain_phases: [{ kill_chain_name: 'mitre-attack', phase_name: 'execution' }],
    x_mitre_is_subtechnique: false,
    x_mitre_platforms: ['Linux'],
  },
};
```

In other words, while the ADM validates fully baked STIX objects that are ready for production use, the REST API also needs to validate draft STIX objects that are still being authored and may not yet be fully compliant with the ADM validation rules. 

Under the hood, the REST API tags the ADM/Zod schema with `.partial()` when the object is flagged as "work-in-progress". However, when we attempt to validate objects with the "awaiting-review" or "reviewed" workflow states, the ADM/Zod schemas are not tagged with `.partial()`, thereby deferring to the underlying ATT&CK & STIX validation rules.

This presents an engineering challenge because it means that we cannot simply implement a synthetic data generator and expose it as an API in the `@mitre-attack/attack-data-model` library, as the validation rules for compliant STIX objects would differ based on the workflow state of the object. We would need to implement logic in the synthetic data generator to determine which fields are required based on the workflow state, and generate compliant STIX objects accordingly. This not only adds complexity to the implementation of the synthetic data generator, but it is arguably out of scope for the `@mitre-attack/attack-data-model` library, which is intended to be a general-purpose library for working with valid ATT&CK content represented in STIX.

One option would be to implement the synthetic data generator in the REST API codebase instead of the `@mitre-attack/attack-data-model` library. This would allow us to tailor the generated STIX objects to be compliant with the specific validation rules of the REST API, including the handling of different workflow states. However, this approach would limit the reusability of the synthetic data generator, as it would be tightly coupled to the REST API's validation logic and may not be suitable for use in other contexts where different validation rules apply.

Another option would be to implement the synthetic data generator in the `@mitre-attack/attack-data-model` library, but to wrap it with yet another API in the REST API codebase that applies the necessary logic to generate compliant STIX objects based on the workflow state. This would allow us to maintain the general-purpose nature of the synthetic data generator while still ensuring that it can be used to generate compliant STIX objects for our regression tests. However, this approach would add an additional layer of complexity to our codebase, as we would need to maintain both the synthetic data generator and the wrapper API in the REST API codebase, and ensure that they remain in sync with each other as we make updates and changes over time.

The REST API does technically already have a utility function for dynamically yielding status-adjusted Zod schemas based on the workflow state of the object being validated:
```
// in app/lib/validation-schemas.js
'use strict';

const {
  tacticSchema,

  /** techniques */
  techniqueSchema,
  techniquePartialSchema,

  /** groups */
  groupSchema,
  groupPartialSchema,

  /** malware */
  malwareSchema,
  malwarePartialSchema,

  /** tools */
  toolSchema,
  toolPartialSchema,

  /** campaigns */
  campaignSchema,
  campaignPartialSchema,

  /** relationships */
  relationshipSchema,
  relationshipPartialSchema,

  /** simple schemas (no checks/refinements) */
  identitySchema,
  mitigationSchema,
  assetSchema,
  dataSourceSchema,
  dataComponentSchema,
  detectionStrategySchema,
  analyticSchema,
  matrixSchema,
  collectionSchema,
  markingDefinitionSchema,
} = require('@mitre-attack/attack-data-model/dist/index.cjs');

// The ADM package exposes two validation shapes for several STIX types:
// - a full schema for normal validation
// - a prebuilt partial schema for draft/work-in-progress validation
//
// Workbench treats `work-in-progress` objects differently from objects in
// later workflow states. WIP objects are allowed to omit fields that are still
// being authored, while `awaiting-review` and `reviewed` objects should be
// held to the complete schema.
//
// We prefer the ADM-provided `*PartialSchema` exports when they exist rather
// than deriving them ourselves at call time. That keeps this layer aligned
// with however ADM composes partial validation for schemas that may include
// additional checks or refinements.
const STIX_SCHEMAS = {
  'x-mitre-tactic': tacticSchema,
  'attack-pattern': {
    full: techniqueSchema,
    partial: techniquePartialSchema,
  },
  'intrusion-set': {
    full: groupSchema,
    partial: groupPartialSchema,
  },
  malware: {
    full: malwareSchema,
    partial: malwarePartialSchema,
  },
  tool: {
    full: toolSchema,
    partial: toolPartialSchema,
  },
  campaign: {
    full: campaignSchema,
    partial: campaignPartialSchema,
  },
  relationship: {
    full: relationshipSchema,
    partial: relationshipPartialSchema,
  },
  identity: identitySchema,
  'course-of-action': mitigationSchema,
  'marking-definition': markingDefinitionSchema,
  'x-mitre-asset': assetSchema,
  'x-mitre-data-source': dataSourceSchema,
  'x-mitre-data-component': dataComponentSchema,
  'x-mitre-detection-strategy': detectionStrategySchema,
  'x-mitre-analytic': analyticSchema,
  'x-mitre-matrix': matrixSchema,
  'x-mitre-collection': collectionSchema,
};

// Cache for locally-derived partial schemas. ADM does not export prebuilt
// partials for every STIX type; for those types we call `.partial()` ourselves.
// That call is expensive enough to show up in bulk-import profiles, so we
// memoize the result per STIX type.
const derivedPartialCache = new Map();

/**
 * Get the schema to use for validating a STIX object.
 *
 * Some STIX types define both a full schema and a prebuilt partial schema,
 * while others only define a single schema (no partial variant). This helper
 * selects the correct schema based on the STIX type and workflow status.
 *
 * Determination rules:
 * - `work-in-progress` uses partial validation so drafts can omit required fields
 * - every other workflow state uses full validation
 * - if ADM exports a dedicated partial schema, use it directly
 * - otherwise, derive a partial schema locally with `.partial()` (memoized)
 *
 * @param {string} stixType - The STIX `type` being validated (e.g. "attack-pattern")
 * @param {string} status - The workflow state (e.g. "work-in-progress", "awaiting-review", "reviewed")
 * @returns {Object|null} Zod schema, or null if the STIX type is unknown
 */
function getSchema(stixType, status) {
  const admSchemaRef = STIX_SCHEMAS[stixType];
  if (!admSchemaRef) return null;

  // Only draft objects get partial validation. Once an object leaves the
  // work-in-progress state, we validate it against the full schema.
  const isWip = status === 'work-in-progress';

  if (admSchemaRef.full && admSchemaRef.partial) {
    return isWip ? admSchemaRef.partial : admSchemaRef.full;
  }

  if (!isWip) return admSchemaRef;

  let derived = derivedPartialCache.get(stixType);
  if (!derived) {
    derived = admSchemaRef.partial();
    derivedPartialCache.set(stixType, derived);
  }
  return derived;
}

module.exports = {
  STIX_SCHEMAS,
  getSchema,
};
```

One final option could be to use `getSchema()` to retrieve the appropriate Zod schema, and then use that schema to generate synthetic data using an established Zod data generation library. Zod officially advertises three libraries for mocking:


Name	Stars	Description
1. `@traversable/zod-test`: 157 GitHub Stars; Random zod schema generator built for fuzz testing; includes generators for both valid and invalid data
2. `zod-schema-faker`: 113 GitHub Stars; Generate mock data from zod schemas. Powered by @faker-js/faker and randexp.js.
3. `zocker`: 98 GitHub Stars; Generates valid, semantically meaningful data for your Zod schemas.

I think this approach is worth exploring. Let's start by assessing the capabilities of these libraries to determine which one would be the best fit for our needs.

The following markdown is the README for [raversable/zod-test](https://github.com/traversable/schema/tree/main/packages/zod-test):

<markdown>
<br>
<h1 align="center">ᯓ𝘁𝗿𝗮𝘃𝗲𝗿𝘀𝗮𝗯𝗹𝗲/𝘇𝗼𝗱-𝘁𝗲𝘀𝘁</h1>
<br>

<p align="center">
  Testing utility that generates arbitrary, <a href="https://en.wikipedia.org/wiki/Pseudorandomness" target="_blank">pseudorandom</a> <a href="https://zod.dev" target="_blank">zod</a> schemas, powered by <a href="https://github.com/dubzzz/fast-check" target="_blank"><code>fast-check</code></a>
</p>

<div align="center">
  <img alt="NPM Version" src="https://img.shields.io/npm/v/%40traversable%2Fzod-test?style=flat-square&logo=npm&label=npm&color=blue">
  &nbsp;
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5.5%2B-blue?style=flat-square&logo=TypeScript&logoColor=4a9cf6">
  &nbsp;
  <img alt="License" src="https://img.shields.io/static/v1?label=License&message=MIT&labelColor=59636e&color=838a93">
  &nbsp;
  <img alt="npm" src="https://img.shields.io/npm/dt/@traversable/zod-test?style=flat-square">
  &nbsp;
</div>

<div align="center">
  <!-- <img alt="npm bundle size (scoped)" src="https://img.shields.io/bundlephobia/minzip/%40traversable/zod-test?style=flat-square&label=size">
  &nbsp; -->
  <img alt="Static Badge" src="https://img.shields.io/badge/%F0%9F%8C%B2-tree--shakeable-brightgreen?labelColor=white">
  &nbsp;
  <img alt="Static Badge" src="https://img.shields.io/badge/ESM-supported-2d9574?style=flat-square&logo=JavaScript">
  &nbsp;
  <img alt="Static Badge" src="https://img.shields.io/badge/CJS-supported-2d9574?style=flat-square&logo=Node.JS">
  &nbsp;
</div>
<br>
<br>

## Requirements

`@traversable/zod-test` has 2 peer dependencies:

1. [`zod`](https://zod.dev/) (v4)
2. [`fast-check`](https://fast-check.dev/)

## Usage

```bash
$ pnpm add -D @traversable/zod-test zod fast-check
```

Here's an example of importing the library:

```typescript
import { z } from 'zod'
import { zxTest } from '@traversable/zod-test'

// see below for specifc examples
```

## Track record

`@traversabe/zod-test` has found several upstream bugs in `zod`:

1. Security exploit: `z.object` pollutes the global `Object` prototype
  - [Issue](https://github.com/colinhacks/zod/issues/4357)
  - [Sandbox](https://stackblitz.com/edit/vitest-dev-vitest-ypelnmjv?file=test%2Frepro.test.ts&initialpath=__vitest__/)

2. Bug: `z.literal` escaping bug
  - [Issue](https://github.com/colinhacks/zod/issues/4894)
  - [Sandbox](https://stackblitz.com/edit/vitest-dev-vitest-w1um2qny?file=test%2Frepro.test.ts&initialpath=__vitest__/)

3. Bug: "Diagonal" objects passed to `z.enum` produce false negatives
- [Issue](https://github.com/colinhacks/zod/issues/4353)
- [Sandbox](https://stackblitz.com/edit/vitest-dev-vitest-srmahjsw?file=package.json,test%2Fenum.test.ts&initialpath=__vitest__/)

4. Bug: `z.file` output type incompatible with `globalThis.File`
  - [Issue](https://github.com/colinhacks/zod/issues/4973)
  - [Sandbox](https://stackblitz.com/edit/zod-file-bug-repro?file=test%2Frepro.test.ts&initialpath=__vitest__/)


## Table of contents

- [`zxTest.fuzz`](https://github.com/traversable/schema/tree/main/packages/zod-test#zxtestfuzz)
- [`zxTest.seedToSchema`](https://github.com/traversable/schema/tree/main/packages/zod-test#zxtestseedtoschema)
- [`zxTest.seedToValidData`](https://github.com/traversable/schema/tree/main/packages/zod-test#zxtestseedtovaliddata)
- [`zxTest.seedToInvalidData`](https://github.com/traversable/schema/tree/main/packages/zod-test#zxtestseedtoinvaliddata)
- [`zxTest.seedToValidDataGenerator`](https://github.com/traversable/schema/tree/main/packages/zod-test#zxtestseedtovaliddatagenerator)
- [`zxTest.seedToInvalidDataGenerator`](https://github.com/traversable/schema/tree/main/packages/zod-test#zxtestseedtoinvaliddatagenerator)
- [`zxTest.SeedGenerator`](https://github.com/traversable/schema/tree/main/packages/zod-test#zxtestseedgenerator)
- [`zxTest.SeedValidDataGenerator`](https://github.com/traversable/schema/tree/main/packages/zod-test#zxtestseedvaliddatagenerator)
- [`zxTest.SeedInvalidDataGenerator`](https://github.com/traversable/schema/tree/main/packages/zod-test#zxtestseedinvaliddatagenerator)


### `zxTest.fuzz`

Convert a Zod schema into a [fast-check](https://github.com/dubzzz/fast-check) arbitrary.

Configure how fuzzed values will be generated via the 2nd argument (`options`).

Override individual arbitraries via the 3rd argument (`overrides`).

> [!NOTE]
>
> `zxTest.fuzz` is the __only__ schema-to-generator function that has itself
> been fuzz tested to ensure that no matter what schema you give it, the data-generator it
> returns will always produce valid data. 
>
> This excludes schemas that make it impossible to generate valid data, for example:
> 
> - `z.never` 
> - `z.nonoptional(z.undefined())`
> - `z.enum([])`
> - `z.union([])`
> - `z.intersection(z.number(), z.string())`

#### Example

```typescript
import * as vi from 'vitest'
import * as fc from 'fast-check'
import { fuzz } from '@traversable/zod-test'

const Schema = z.record(
  z.string(), 
  z.union(
    z.number(),
    z.string(),
  )
)

const generator = fuzz(
  Schema, 
  { record: { minKeys: 1 }, number: { noDefaultInfinity: true } },
  { string: () => fc.stringMatching(/[\S\s]+[\S]+/) },
)

vi.test('fuzz test example', () => {
  fc.assert(
    fc.property(generator, (data) => {
      vi.assert.doesNotThrow(() => Schema.parse(data))
    }),
    { numRuns: 1_000 }
  )
})
```

#### See also
- the [fast-check docs](https://fast-check.dev)


### `zxTest.seedToSchema`

Use `zxTest.seedToSchema` to convert a seed generated by `zxTest.SeedGenerator` into a
zod schema that satisfies the configuration options you specified.

#### Example

```typescript
import { zxTest } from '@traversable/zod-test'
import * as fc from 'fast-check'

const builder = zxTest.SeedGenerator()['*']
const [mySeed] = fc.sample(builder.object, 1)

const mySchema = zxTest.seedToSchema(mySeed)
//    ^? const mySchema: z.ZodType
```


### `zxTest.seedToValidData`

Use `zxTest.seedToValidData` to convert a seed generated by `zxTest.SeedGenerator` into
data that satisfies the schema that the seed represents.

#### Example

```typescript
import { zxTest } from '@traversable/zod-test'
import * as fc from 'fast-check'

const builder = zxTest.SeedGenerator()['*']
const [mySeed] = fc.sample(builder.object, 1)

const mySchema = zxTest.seedToSchema(mySeed)
//    ^? const mySchema: z.ZodType

const validData = zxTest.seedToValidData(mySeed)

mySchema.parse(validData) // will never throw
```


### `zxTest.seedToInvalidData`

Use `zxTest.seedToInvalidData` to convert a seed generated by `zxTest.SeedGenerator` into
data that does **not** satisfy the schema that the seed represents.

#### Example

```typescript
import { zxTest } from '@traversable/zod-test'
import * as fc from 'fast-check'

const builder = zxTest.SeedGenerator()['*']
const [mySeed] = fc.sample(builder.object, 1)

const mySchema = zxTest.seedToSchema(mySeed)
//    ^? const mySchema: z.ZodType

const invalidData = zxTest.seedToValidData(mySeed)

mySchema.parse(invalidData) // should always throw
```


### `zxTest.seedToValidDataGenerator`

Like [`zxTest.seedToValidData`](https://github.com/traversable/schema/tree/main/packages/zod-test#zxtestseedtovaliddata), except `zxTest.seedToValidDataGenerator` accepts a seed and returns a valid data arbitrary (which can then be used to produce valid data).

#### Example

```typescript
import { zxTest } from '@traversable/zod-test'
import * as fc from 'fast-check'

const builder = zxTest.SeedGenerator()['*']
const [mySeed] = fc.sample(builder.object, 1)

const mySchema = zxTest.seedToSchema(mySeed)
//    ^? const mySchema: z.ZodType

const validDataGenerator = zxTest.seedToValidDataGenerator(mySeed)
const [validData] = fc.sample(validDataGenerator, 1)

mySchema.parse(validData) // will never throw
```


### `zxTest.seedToInvalidDataGenerator`

Like [`zxTest.seedToInvalidData`](https://github.com/traversable/schema/tree/main/packages/zod-test#zxtestseedtoinvaliddata), except `zxTest.seedToValidDataGenerator` accepts a seed and returns an invalid data arbitrary (which can then be used to produce invalid data).

#### Example

```typescript
import type * as z from 'zod'
import * as fc from 'fast-check'
import { zxTest } from '@traversable/zod-test'

const builder = zxTest.SeedGenerator()['*']
const [mySeed] = fc.sample(builder.object, 1)

const mySchema = zxTest.seedToSchema(mySeed)
//    ^? const mySchema: z.ZodType

const invalidDataGenerator = zxTest.seedToInvalidDataGenerator(mySeed)
const [invalidData] = fc.sample(invalidDataGenerator, 1)

mySchema.parse(invalidData) // will always throw
```


### `zxTest.SeedGenerator`

> [!NOTE]
>
> `zxTest.SeedGenerator` is fairly low-level. All of the other exports of this library have been implemented in terms of `zxTest.SeedGenerator`.

Generates a configurable, pseudo-random "seed builder".

- Use [`zxTest.seedToSchema`](https://github.com/traversable/schema/tree/main/packages/zod-test#zxtestseedtoschema) to convert a seed into a zod schema
- Use [`zxTest.seedToValidData`](https://github.com/traversable/schema/tree/main/packages/zod-test#zxtestseedtovaliddata) to convert a seed into valid data
- Use [`zxTest.seedToInvalidData`](https://github.com/traversable/schema/tree/main/packages/zod-test#zxtestseedtoinvaliddata) to convert a seed into invalid data

#### Example

```typescript
import { zxTest } from '@traversable/zod-test'
import * as fc from 'fast-check'

const builder = zxTest.SeedGenerator({
  include: ["boolean", "string", "object"],
  // 𐙘 use `include` to only include certain schema types
  exclude: ["boolean", "any"],
  // 𐙘 use `exclude` to exclude certain schema types altogether (overrides `include`)
  object: { maxKeys: 5 },
  // 𐙘 specific arbitraries are configurable by name
})

// included schemas are present as properties on your generator...
builder.string
builder.object

// ...excluded schemas are not present...
builder.boolean // 🚫 TypeError

// ...a special wildcard `"*"` property (pronounced "surprise me") is always present:
builder["*"]

/**
 * `fast-check` will generate a seed, which is a data structure containing
 * integers that represent a kind of AST.
 *
 * To use a seed, you need to pass it to an interpreter like `zxTest.seedToSchema`,
 * `zxTest.seedToValidData` or `zxTest.seedToInvalidData`:
 */

const [mySeed] = fc.sample(builder.object, 1)

const mySchema = zxTest.seedToSchema(mySeed)
//    ^? const mySchema: z.ZodType

const validData = zxTest.seedToValidData(mySeed)
//    ^? since the `mySeed` was also used to generate `mySchema`,
//       parsing `validData` should always succeed

const invalidData = zxTest.seedToInvalidData(mySeed)
//    ^? since the `mySeed` was also used to generate `mySchema`,
//       parsing `invalidData` should always fail
```


### `zxTest.SeedValidDataGenerator`

Like [`zxTest.SeedGenerator`](https://github.com/traversable/schema/tree/main/packages/zod-test#zxtestseedgenerator), except `zxTest.SeedValidDataGenerator` comes pre-configured to exclude schemas that make it impossible to reliably generate valid data.

> [!NOTE]
>
> `zxTest.SeedValidDataGenerator` does not accept any options. If you need more fine-grained control of the schemas being generated, use [`zxTest.SeedGenerator`](https://github.com/traversable/schema/tree/main/packages/zod-test#zxtestseedgenerator).



### `zxTest.SeedInvalidDataGenerator`

Like [`zxTest.SeedGenerator`](https://github.com/traversable/schema/tree/main/packages/zod-test#zxtestseedgenerator), except `zxTest.SeedValidDataGenerator` comes pre-configured to exclude schemas that make it impossible to reliably generate invalid data.

> [!NOTE]
>
> `zxTest.SeedInvalidDataGenerator` does not accept any options. If you need more fine-grained control of the schemas being generated, use [`zxTest.SeedGenerator`](https://github.com/traversable/schema/tree/main/packages/zod-test#zxtestseedgenerator).
</markdown>

The second option is [Zocker](https://zocker.sigrist.dev/?id=zocker). I have personally tested this one and verified basic functionality seems to work:

```typescript
import { zocker } from "zocker";
import { z } from 'zod/v4';

// Manually create a compatible schema based on the structure
const compatibleSchema = z.object({
    id: z.string(),
    type: z.enum([
        "attack-pattern",
        "bundle",
        "campaign",
        "course-of-action",
        "extension-definition",
        "identity",
        "intrusion-set",
        "malware",
        "tool",
        "marking-definition",
        "x-mitre-analytic",
        "x-mitre-data-component",
        "x-mitre-detection-strategy",
        "x-mitre-tactic",
        "x-mitre-asset",
        "x-mitre-data-source",
        "x-mitre-log-source",
        "x-mitre-matrix",
        "x-mitre-collection",
        "relationship",
        "file",
        "artifact"
    ]),
    spec_version: z.enum(["2.0", "2.1"]),
    created: z.string(), // Should be a timestamp
    modified: z.string(), // Should be a timestamp
    created_by_ref: z.string().optional(),
    labels: z.array(z.string()).optional(),
    revoked: z.boolean().optional(),
    confidence: z.int().min(1).max(99).optional(),
    lang: z.string().optional(),
    external_references: z.array(z.object({
        source_name: z.string(),
        description: z.string().optional(),
        url: z.url().optional(),
        external_id: z.string().optional()
    })).optional(),
    object_marking_refs: z.array(z.string()).optional(),
    granular_markings: z.array(z.object({
        marking_ref: z.string(),
        selectors: z.array(z.string())
    })).optional(),
    extensions: z.record(z.string(), z.unknown()).optional()
}).strict();

const out = zocker(compatibleSchema).generate();
console.log(out);
```

The last option is [zod-schema-faker](https://github.com/soc221b/zod-schema-faker). I have not personally tested this one, but based on the documentation it appears to be a straightforward library for generating mock data from Zod schemas. It is powered by `@faker-js/faker` and `randexp.js`, which are both well-known libraries for generating fake data and regular expression-based data, respectively.

Please check out the documentation for all three libraries and let me know which one you think would be the best fit for our needs.

Afterwards, please familiarize yourself with the implementation of the `getSchema()` function in `app/lib/validation-schemas.js`, as well as the structure of the STIX objects being used in our regression tests, so that you can design a synthetic data generator that can produce compliant STIX objects based on the appropriate Zod schemas and workflow states.
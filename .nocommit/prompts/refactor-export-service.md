Please read the specification and concept documentation for the "release tracks" feature, which is actively in development, at `docs/COLLECTIONS_V2/`. Once you have a lay of the land, focus on helping me refactoring the export service (`app/services/release-tracks/export-service.js`), and update the application code and documentation (only if necessary). 

Context: 
I am interested in using Zod v4 to encapsulate DTO transformation logic. The benefit being that we can define a Zod schema for each of the output formats (`workbench`, `bunde`, `filesystemstore`), which are self-contained, easy to read, and well supported. The input data would be the `snapshot` object, which is retrieved from the snapshot service and passed to the `exportSnapshot` function as the first positional argument (also labeled `snapshot`).

<Zod-Documentation>
## Transforms

Note: For bi-directional transforms, use codecs.

Transforms are a special kind of schema that perform a unidirectional transformation. Instead of validating input, they accept anything and perform some transformation on the data. To define a transform:

```javascript
const castToString = z.transform((val) => String(val));
 
castToString.parse("asdf"); // => "asdf"
castToString.parse(123); // => "123"
castToString.parse(true); // => "true"
```

Transform functions should never throw. Thrown errors are not caught by Zod.

To perform validation logic inside a transform, use `ctx`. To report a validation issue, push a new issue onto `ctx.issues` (similar to the `.check()` API).

```javascript
const coercedInt = z.transform((val, ctx) => {
  try {
    const parsed = Number.parseInt(String(val));
    return parsed;
  } catch (e) {
    ctx.issues.push({
      code: "custom",
      message: "Not a number",
      input: val,
    });
 
    // this is a special constant with type `never`
    // returning it lets you exit the transform without impacting the inferred return type
    return z.NEVER;
  }
});
```

Most commonly, transforms are used in conjunction with Pipes. This combination is useful for performing some initial validation, then transforming the parsed data into another form.

```javascript
const stringToLength = z.string().pipe(z.transform(val => val.length));
stringToLength.parse("hello"); // => 5
```

## `.transform()`

Piping some schema into a transform is a common pattern, so Zod provides a convenience `.transform()` method.

```javascript
const stringToLength = z.string().transform(val => val.length);
```
</Zod-Documentation>

The source code is located in the `app/` folder. Additionally, the following documentation files may help contextualize some critical aspects of the software design:

- `docs/EVENT_BUS_ARCHITECTURE.md`
- `docs/CROSS_SERVICE_READS_PATTERN.md`
- `docs/LIFECYCLE_HOOKS_GUIDE.md`
- `docs/COLLECTIONS_V2/99_IMPLEMENTATION_PLAN.md`
- `docs/COLLECTIONS_V2/99_SERVICE_LAYER_IMPLEMENTATION_PLAN.md`

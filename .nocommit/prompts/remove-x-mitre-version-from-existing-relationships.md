Please create a database migration script and place it in `migrations/` that retroactively removes the `x_mitre_version`
field from all non-deprecated relationship documents in the `relationships` Mongo collection.

Context: Historically, we used to store `x_mitre_version` on relationships. But we've since changed the ATT&CK specification, specifying that the field is no longer permitted on SROs. There are old relationships lingering in some Workbench instances that still contain this field. If you try to amend those relationship documents using the standard POST workflow, the operation will fail due to ADM validation errors, because the ADM will detect the presence of `x_mitre_version` on the posted object (since we're just posting the preexisting object with whatever fields modified) and throw a `ValidationError`.

Here's an example of an invalid relationship:

```javascript
{
  workspace: {
    workflow: {
      state: "reviewed",
      created_by_user_account: "identity--b5220818-f881-4f4a-9091-00a07cf2a576",
    },
    validation: {
      errors: [
        {
          message: " is Unrecognized key: \"x_mitre_version\"",
          path: [
          ],
          code: "unrecognized_keys",
        },
      ],
      attack_spec_version: "3.3.0",
      adm_version: "4.10.0",
      validated_at: "2026-04-10T15:27:01.953Z",
    },
  },
  stix: {
    object_marking_refs: [
      "marking-definition--fa42a846-8d90-4e51-bc29-71d5b4802168",
    ],
    type: "relationship",
    id: "relationship--06068b8a-0bfe-499c-8c7c-3cf3123a3541",
    created: "2022-07-08T13:57:50.268Z",
    x_mitre_version: "0.1",
    external_references: [
      {
        source_name: "Microsoft POLONIUM June 2022",
        url: "https://www.microsoft.com/security/blog/2022/06/02/exposing-polonium-activity-and-infrastructure-targeting-israeli-organizations/",
        description: "Microsoft. (2022, June 2). Exposing POLONIUM activity and infrastructure targeting Israeli organizations. Retrieved July 1, 2022.",
      },
    ],
    x_mitre_deprecated: true,
    description: "(LinkById: S1023) has the ability to disable OneDrive protections that prevent the theft of token and client secrets.(Citation: Microsoft POLONIUM June 2022)",
    spec_version: "2.1",
    modified: "2022-08-10T13:01:17.510Z",
    created_by_ref: "identity--c78cb6e5-0c4b-4611-8297-d1b8b55e40b5",
    relationship_type: "uses",
    source_ref: "malware--750eb92a-7fdf-451e-9592-1d42357018f1",
    target_ref: "attack-pattern--cb715638-29a5-425c-bf77-c805ef3d7cb1",
    x_mitre_modified_by_ref: "identity--c78cb6e5-0c4b-4611-8297-d1b8b55e40b5",
    x_mitre_attack_spec_version: "3.3.0",
    revoked: false,
  },
}
```

And here's a validation error that would occur on the above object:
```
[
  {
    message: " is Unrecognized key: \"x_mitre_version\"",
    path: [
    ],
    code: "unrecognized_keys",
    input: undefined,
  },
]
```

We need to apply a database fix to bring preexisting documents into compliance with the new business logic.
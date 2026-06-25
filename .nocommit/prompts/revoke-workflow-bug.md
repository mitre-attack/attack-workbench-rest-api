I think there might be a logic bug in the `BaseService.revoke` method.

Please read the method, as well as the documentation in `docs/user/revoke-workflow.md` before we get started.

I think there is a bug in the way we migrate relationships from the revoked object to the revoking object when the `preserveRelationships` query parameter is set.

The fundamental goal is to enable a pathway for carrying over relationships that exist on the revoked object onto the revoking object. You might imagine an object being the `source_ref` or `target_ref` or hundreds of relationships, and so this workflow should enable migrating such relationships onto some new/different object the _revoking_ object).

But I think there's an issue with the logic that determines exactly which relationships to carry over. It says:

> If the revoking object (Object B) already participates in a relationship with the same source, target, and relationship type as an existing relationship of the revoked object (Object A), the transfer is skipped and a warning is included in the response.

But this is wrong. It's not possible for Object 'foo' to participate in an identical SRO as Object 'bar' unless the SRO were literally between the two of them. Just think about it:

```json
// relationship1
{
    "relationship_type": "mitigates",
    "source_ref": "course-of-action--1234",
    "target_ref": "attack-pattern-1234" // <-- this is 'foo'
},
// relationship2
{
    "relationship_type": "mitigates",
    "source_ref": "course-of-action--1234",
    "target_ref": "attack-pattern-5678" // <-- this is 'bar'
}
```

Let's assume here that we're revoking 'foo' with 'bar'. foo will become revoked, and all of its relationships will be preserved on 'bar'.

Here, we show situation where we'd want to skip the "preserving" process for relationship1. In other words, we should not preserve the relationship above, dubbed 'relationship1', on 'bar', because 'bar' already has that relationship —— it's relationship2!

I think we need to amend our business logic to say: "If the revoking object already participates in a relationship with the same relationship type AND the same source OR target, the transfer should be skipped. In other words, if there exists an essentially identical relationship already where the only difference is the revoking and revoked STIX IDs are hotswappable in either the `source_ref` or `target_ref` fields, then that relationship should be skipped.

Moreover, we need to consider potential edge cases. For example:

We can see that the server throws a `BadRequestError` if the revoking object is not of the same type as the revoked object, but this does not cover the case of subtechniques (subs) and techniques (parents). I think it should be permissible for subs to revoke parents and vice versa, but we need to reason through the implications and limitations to avoid from putting the database into an invalid state.

If a subtechnique (Object B) revokes a parent (Object A), then we should require that Object B is NOT a subtechnique of Object A. Otherwise weirdness might ensue if we set `preserveRelationships=true`:
    - If Object A has _other_ subtechniques, they would be migrated to Object B, leaving us with a state where subtechniques are subtechniques of other subtechniques. This is not permissible: subtechniques can only be subtechniques of parent techniques, i.e., nested subtechniques are not permitted.
    - We would also end up with Object B being orphaned (a subtechnique without a parent). If this is the desired operation, then Object B should first be converted to a parent. There are separate workflow endpoints for converting techniques to subtechniques and vice versa.

Are there other edge cases we need to consider?

Is our logic for identifying out-of-scope relationships that should be skipped during the preservation process actually correct?

Please reason about the current state of the revoke workflow and the concerns brought forth and determine if we need to make any modifications.

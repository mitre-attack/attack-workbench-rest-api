Let's plan a workflow to handle converting techniques to and from sub-technique status.

Before we get started, let's level-set on some terminology:
- I refer to "standard" techniques as "parents", irrespective of whether they actually contain a sub-technique or not. These are any technique whose `x_mitre_is_subtechnique` field is equal to `False`
- I refer to sub-techniques as "subs" or "children". These are any technique whose `x_mitre_is_subtechnique` field is equal to `True`

Currently, the backend/REST API treats toggling this field as just like any other STIX modification: it will happily accept a POST or PUT request where the value of `x_mitre_is_subtechnique` flips in either direction (False<-->True). There are no built-in guards to protect against the user from putting the data into an invalid state (described below). We rely solely on the frontend SPA to handle orchestrating and blocking conversion requests which would put the data into an invalid state.

So what constitutes an invalid state? Consider the following:

If a parent (let's call it $parent_A$) contains one or more subs, then the subs must be rehomed or converted to parents themselves before $parent_A$ can be converted to a sub. Otherwise the end state will contain subs that don't have a parent. We informally refer to these as "orphans" and they are not permissible in final STIX bundle outputs.

Here are some potential solutions that I am considering. Notably, none of them are mutually exclusive:

1. We can introduce backend guardrails to block requests that would result in orphans being created.
2. We can introduce a new query parameter that allows users to override the aforementioned guardrail, e.g., `permitOrphans: bool`.
3. We can introduce a backend-driven "parent-to-sub conversion" workflow that allows users to bulk-edit all of $parent_A$'s subs as part of the conversion operation, thereby giving the REST API all of the information needed to reach a valid end state without creating orphans. In such a workflow, the user could specify, for each sub, whether to re-home the sub to a new parent or convert it to a parent itself.
4. Optionally, we can build in more tolerances to support "invalid states". Theoretically, it should be fine as long as the "orphans" are tagged/marked accordingly and easy to query. For example, we could introduce a new metadata field like `workspace.is_orphaned: bool` and add a new query parameter to allow users to retrieve orphans, e.g., `GET /api/techniques?include={parent,sub,orphan,all}`, `GET /api/techniques?includeOrphans=true`, etc.
5. In addition, we need to consider the "sub-to-parent conversion" workflow. I believe the only dimension to consider here is the sub's ATT&CK ID. It will need to be assigned a new ATT&CK ID without the sub-technique suffix. Thus, we will need to add support for regenerating a new ATT&CK ID specifically for subs that are being converted to parents.
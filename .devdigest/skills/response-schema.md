# response-schema

Flag any change to the shape of an API response that could cause a client to fail when deserialising or accessing fields.
"Shape" means: field names, field types, nullability, optionality, nesting depth.

Flag the offending `file:line`, show the before/after schema diff, and state which clients are at risk.

## Examples

### ❌ Bad — field renamed

```diff
- { "userId": "abc123" }
+ { "user_id": "abc123" }
```

`userId` is now `user_id`. Any client reading `.userId` gets `undefined` — silent data loss.

### ❌ Bad — field removed

```diff
- { "id": "1", "email": "a@b.com", "role": "admin" }
+ { "id": "1", "email": "a@b.com" }
```

`role` removed. Clients that branch on `user.role` will behave incorrectly.

### ✅ Good — additive field

```diff
  { "id": "1", "email": "a@b.com"
+ , "avatar_url": "https://..." }
```

New optional field. Existing clients ignore it; new clients can use it.

## Rules

1. Renaming any field in a response body is breaking — even if the old name was "wrong".
2. Removing a field that clients currently read is breaking.
3. Changing a field type (e.g. `string` → `number`, `string` → `string[]`) is breaking.
4. Making a nullable field non-nullable (or vice versa) is breaking.
5. Changing the nesting level of an existing field is breaking.
6. Reordering array elements in a stable response is breaking when clients index by position.
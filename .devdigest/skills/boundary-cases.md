# Boundary Case Coverage

For every new or modified function in the diff, verify boundary inputs are exercised.

## Boundary checklist

- **Empty**: empty string "", empty array [], empty object {}
- **Zero / negative**: numeric arguments at 0 and -1
- **Null / undefined**: optional parameters not passed, nullable fields set to null
- **Single element**: collection-processing functions tested with exactly one element
- **Exact limit**: if there is a size limit, test at limit-1, limit, limit+1

## Reporting rule

For each function introduced in the diff, list which boundary cases are missing.
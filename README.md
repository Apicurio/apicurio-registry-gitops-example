# Apicurio Registry GitOps Example

Example data repository for [Apicurio Registry](https://github.com/Apicurio/apicurio-registry)
in GitOps mode. Demonstrates how schemas and registry metadata can be managed declaratively
through Git.

## Scenario

An e-commerce platform where teams manage schemas close to their service code.
The registry aggregates schemas from multiple sources into a unified view.

**This repository (main branch)** — the **Platform team** manages:
- **Registry configuration** — prod and staging environments with different rule policies
- **Common schemas** — shared data types (Address, Money) used across services
- **Orders schemas** — the core order-created domain event

**Fulfillment branch** — the **Fulfillment team** manages:
- **Fulfillment schemas** — shipment events for the fulfillment service
- **Experimental schemas** — staging-only schemas for features in development

## Repository Layout

```
main branch (Platform team):
├── config/
│   ├── prod.registry.yaml              # Prod: strict rules (VALIDITY + COMPATIBILITY)
│   └── staging.registry.yaml           # Staging: no global rules
├── common/
│   ├── common.registry.yaml            # Group: shared data types
│   ├── address.registry.yaml           # Artifact: Address (JSON Schema)
│   ├── address.json
│   ├── money.registry.yaml             # Artifact: Money (JSON Schema)
│   └── money.json
└── orders/
    ├── orders.registry.yaml            # Group: order service schemas
    ├── order-created.registry.yaml     # Artifact: Order Created (Avro)
    ├── order-created-v1.avsc
    └── order-created-v2.avsc

fulfillment branch (Fulfillment team):
├── fulfillment/
│   ├── fulfillment.registry.yaml       # Group: fulfillment service schemas
│   ├── shipment-created.registry.yaml  # Artifact: Shipment Created (Avro)
│   └── shipment-created-v1.avsc
└── experimental/
    ├── experimental.registry.yaml      # Group: staging-only experiments
    ├── delivery-eta.registry.yaml      # Artifact: Delivery ETA (JSON Schema)
    └── delivery-eta-v1.json
```

## Usage

### Single-repo mode

Use just the `main` branch with a single registry instance:

```bash
# See examples/gitops/ in the apicurio-registry repository
docker compose up
```

- **Prod** (`APICURIO_POLLING_STORAGE_ID=prod`): loads common + orders (with strict rules)
- **Staging** (`APICURIO_POLLING_STORAGE_ID=staging`): loads common + orders (no global rules)

### Multi-repo mode

Use both branches to aggregate schemas from two teams:

```yaml
# Registry configuration
APICURIO_GITOPS_REPOS_0_DIR: platform
APICURIO_GITOPS_REPOS_0_BRANCH: main
APICURIO_GITOPS_REPOS_1_DIR: fulfillment
APICURIO_GITOPS_REPOS_1_BRANCH: fulfillment

# Sidecar pulls both branches into separate directories
APICURIO_GITOPS_REPOS_0_URL: https://github.com/Apicurio/apicurio-registry-gitops-example.git
APICURIO_GITOPS_REPOS_1_URL: https://github.com/Apicurio/apicurio-registry-gitops-example.git
```

- **Prod**: loads common + orders + fulfillment (no experimental)
- **Staging**: loads common + orders + fulfillment + experimental

## Multi-Registry Routing

The `registryIds` field controls which registry instance loads each entity:

| Entity | `registryIds` | Loaded by |
|--------|--------------|-----------|
| common group + artifacts | `[prod, staging]` | Both |
| orders group + artifacts | `[prod, staging]` | Both |
| fulfillment group + artifacts | `[prod, staging]` | Both |
| experimental group + artifacts | `[staging]` | Staging only |

## PR Validation

This repository includes a GitHub Actions workflow (`.github/workflows/validate-schemas.yml`)
that validates schema changes in pull requests against a running Apicurio Registry instance.

### Setup for your fork

1. Deploy an Apicurio Registry instance in GitOps mode, configured to pull from your fork
2. Go to **Settings > Secrets and variables > Actions > Variables**
3. Add repository variable: `REGISTRY_URL` = your registry's base URL (e.g., `https://registry.example.com`)
4. (Optional) Add variable: `REGISTRY_REPO_ID` = your repository ID (default: `default`)
5. (Optional) Add secret: `REGISTRY_TOKEN` = bearer token for registry authentication

Once configured, the workflow runs automatically on PRs that modify schema files and reports
pass/fail as a PR check.

### How it works

The workflow uses `scripts/validate.ts` to:
1. Call `POST /admin/gitops/validate` with the PR branch name
2. Poll `GET /admin/gitops/validate/{taskId}` until the validation completes
3. Report success or failure with detailed error messages

The validation runs the same rules as a normal GitOps sync (validity, compatibility, integrity)
but without affecting the live registry data.

## Test Branches

The following branches are used by the Apicurio Registry operator integration tests
for dry-run validation. **Do not modify or delete these branches** without updating the
corresponding tests in `operator/controller/src/test/java/.../it/GitOpsITTest.java`.

| Branch | Purpose | Expected Validation Result |
|--------|---------|---------------------------|
| `test/valid-pr` | Adds an optional field to `order-created` (backward compatible) | Success |
| `test/invalid-pr` | Removes required fields from `order-created` (backward incompatible) | Failure |

These branches simulate pull request changes that the dry-run validation endpoint validates
against the registry's configured rules (BACKWARD compatibility on the `order-created` artifact).

## Data Format

See the [Apicurio Registry GitOps documentation](https://github.com/Apicurio/apicurio-registry/blob/main/app/src/main/java/io/apicurio/registry/storage/impl/gitops/README.md)
for the full data format reference.

#!/usr/bin/env -S npx tsx
/**
 * Apicurio Registry GitOps Dry-Run Validation Script
 *
 * Validates schema changes against a running Apicurio Registry instance
 * by calling the dry-run validation REST API. Designed to be used in
 * CI/CD pipelines (GitHub Actions, GitLab CI, etc.) to block PR merges
 * that would break schema compatibility.
 *
 * Usage:
 *   npx tsx scripts/validate.ts \
 *     --registry-url https://registry.example.com \
 *     --repo-id default \
 *     --ref refs/pull/42/head
 *
 * Environment variables (alternative to CLI args):
 *   REGISTRY_URL      - Registry base URL
 *   REGISTRY_REPO_ID  - Repository ID (default: "default")
 *   REGISTRY_REF      - Git ref to validate
 *   REGISTRY_TOKEN    - Bearer token for authentication (optional)
 *   REGISTRY_TIMEOUT  - Timeout in seconds (default: 300)
 */

const POLL_INTERVAL_MS = 3000;

interface ValidateTask {
    taskId: string;
    state: string;
    result?: string;
    repoId?: string;
    ref?: string;
    groupCount?: number;
    artifactCount?: number;
    versionCount?: number;
    errors?: Array<{
        detail: string;
        source?: string;
        context?: string;
    }>;
}

function parseArgs(): {
    registryUrl: string;
    repoId: string;
    ref: string;
    token?: string;
    timeout: number;
} {
    const args = process.argv.slice(2);
    const parsed: Record<string, string> = {};

    for (let i = 0; i < args.length; i += 2) {
        const key = args[i].replace(/^--/, "").replace(/-/g, "_");
        parsed[key] = args[i + 1];
    }

    return {
        registryUrl: (
            parsed.registry_url || process.env.REGISTRY_URL || ""
        ).replace(/\/$/, ""),
        repoId: parsed.repo_id || process.env.REGISTRY_REPO_ID || "default",
        ref: parsed.ref || process.env.REGISTRY_REF || "",
        token: parsed.token || process.env.REGISTRY_TOKEN,
        timeout: parseInt(
            parsed.timeout || process.env.REGISTRY_TIMEOUT || "300",
            10
        ),
    };
}

async function apiCall(
    url: string,
    method: string,
    token?: string,
    body?: unknown
): Promise<unknown> {
    const headers: Record<string, string> = {
        "Content-Type": "application/json",
    };
    if (token) {
        headers["Authorization"] = `Bearer ${token}`;
    }

    const response = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`HTTP ${response.status}: ${text}`);
    }

    const contentType = response.headers.get("content-type");
    if (contentType?.includes("application/json")) {
        return response.json();
    }
    return null;
}

async function main() {
    const config = parseArgs();

    if (!config.registryUrl) {
        console.error(
            "Error: --registry-url or REGISTRY_URL is required"
        );
        process.exit(1);
    }
    if (!config.ref) {
        console.error("Error: --ref or REGISTRY_REF is required");
        process.exit(1);
    }

    const baseUrl = `${config.registryUrl}/apis/registry/v3/admin/gitops/validate`;

    console.log(`Validating ref '${config.ref}' against repo '${config.repoId}'`);
    console.log(`Registry: ${config.registryUrl}`);

    // Create validation task
    const task = (await apiCall(baseUrl, "POST", config.token, {
        type: "pull",
        repoId: config.repoId,
        ref: config.ref,
    })) as ValidateTask;

    console.log(`Task created: ${task.taskId} (state: ${task.state})`);

    // Poll until completion
    const deadline = Date.now() + config.timeout * 1000;
    let result: ValidateTask = task;

    while (Date.now() < deadline) {
        await new Promise((resolve) =>
            setTimeout(resolve, POLL_INTERVAL_MS)
        );

        result = (await apiCall(
            `${baseUrl}/${task.taskId}`,
            "GET",
            config.token
        )) as ValidateTask;

        const state = result.state;
        if (state === "completed" || state === "failed") {
            break;
        }

        process.stdout.write(`  State: ${state}\r`);
    }

    console.log("");

    if (
        result.state !== "completed" &&
        result.state !== "failed"
    ) {
        console.error(
            `Timeout: validation did not complete within ${config.timeout}s (state: ${result.state})`
        );
        process.exit(2);
    }

    // Report results
    if (result.result === "success") {
        console.log("✅ Validation passed");
        console.log(
            `   Groups: ${result.groupCount}, Artifacts: ${result.artifactCount}, Versions: ${result.versionCount}`
        );
        process.exit(0);
    } else {
        console.error("❌ Validation failed");
        if (result.errors && result.errors.length > 0) {
            console.error(`   ${result.errors.length} error(s):`);
            for (const error of result.errors) {
                const location = [error.source, error.context]
                    .filter(Boolean)
                    .join("/");
                console.error(
                    `   - ${error.detail}${location ? ` (${location})` : ""}`
                );
            }
        }
        process.exit(1);
    }
}

main().catch((err) => {
    console.error(`Error: ${err.message}`);
    process.exit(1);
});

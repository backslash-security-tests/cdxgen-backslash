# Create custom SBOMs for OWASP juice-shop

## Learning Objective

This guide demonstrates how to generate various SBOMs for the OWASP [Juice Shop](https://github.com/juice-shop/juice-shop), a known vulnerable web application featuring a Node.js backend and an Angular.js frontend.

## Pre-requisites

Ensure the following tools are installed.

```
Node.js >= 24  (to run cdxgen itself)
```

> Note: cdxgen requires Node.js >= 24, but Juice Shop's own native dependencies
> only build on Node.js 20–22. These are separate requirements — see
> [Important Considerations](#important-considerations) below for the
> `-t node20` workflow that installs the older Node just for the target app.

## Getting started

Install cdxgen

```shell
sudo npm install -g @cdxgen/cdxgen
```

Clone

```shell
git clone https://github.com/juice-shop/juice-shop
```

### Important Considerations

- Custom .npmrc: Juice Shop uses a .npmrc that prevents lock file creation. Without a lock file, SBOM accuracy decreases since dependency trees cannot be fully resolved.
- Native Builds: Some packages require native builds and may fail on certain Node.js versions (>23), CPU architectures (e.g., linux/arm64), or Windows platforms.

For best results, build Juice Shop with Node.js 20–22 on Linux (amd64) or macOS (cdxgen
itself still runs on Node.js >= 24). Set the environment variable `NPM_INSTALL_ARGS="--package-lock --legacy-peer-deps"` prior to invoking cdxgen.

```shell
cd juice-shop
export NPM_INSTALL_ARGS="--package-lock --legacy-peer-deps"
cdxgen -o bom.json -t js .
```

## container-based invocations

Using the cdxgen container images could simplify the SBOM generation. However, be aware of the various configurations needed for a successful generation.

### Use the default image with a specific type

> The dedicated `ghcr.io/cdxgen/cdxgen-node20` image was removed in cdxgen v13,
> since cdxgen itself now requires Node.js >= 24. Use `-t node20` with the default
> image instead — it installs Node.js 20 for the _target application_ only.

The default image of cdxgen `ghcr.io/cdxgen/cdxgen:latest` bundles node 24 or higher, which is incompatible with juice-shop. Pass the type `-t node20` to automatically install node.js 20 and use the same for the SBOM generation.

```shell
docker run --rm -e CDXGEN_DEBUG_MODE=debug -e "NPM_INSTALL_ARGS=--package-lock --legacy-peer-deps" -v /tmp:/tmp -v $(pwd):/app:rw -t ghcr.io/cdxgen/cdxgen:latest -t node20 -r /app -o /app/bom.json
```

For nerdctl users:

```shell
nerdctl run --rm -e CDXGEN_DEBUG_MODE=debug -e "NPM_INSTALL_ARGS=--package-lock --legacy-peer-deps" -v /tmp:/tmp -v $(pwd):/app:rw -t ghcr.io/cdxgen/cdxgen:latest -t node20 -r /app -o /app/bom.json
```

## ML profile

To generate an SBOM designed for AI-driven analysis (e.g., with [cdxgenGPT](https://chatgpt.com/g/g-673bfeb4037481919be8a2cd1bf868d2-cyclonedx-generator-cdxgen)), include the `--profile ml` argument.

```shell
docker run --rm -e CDXGEN_DEBUG_MODE=debug -e "NPM_INSTALL_ARGS=--package-lock --legacy-peer-deps" -v /tmp:/tmp -v $(pwd):/app:rw -t ghcr.io/cdxgen/cdxgen:latest -t node20 --profile ml -r /app -o /app/bom.json
```

This process may take 5–10 minutes. Once complete, you can use the resulting SBOM file for AI-driven analysis, dataset creation, or ML model training.

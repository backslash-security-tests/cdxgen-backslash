#! /bin/sh
# Shared cdxgen builder stage for the cdxgen container images.
#
# This script runs in the intermediate cdxgen-builder stage: it installs the
# cdxgen production dependencies with pnpm and warms the node compile cache.
# Only /opt/cdxgen and the warmed cache are copied into the final cdxgen
# stage, so pnpm/corepack/npm caches never leak into the published image.
#
# Environment variables honoured (in addition to the mirror build args from
# mirrors.sh):
#   CDXGEN_INSTALL_NO_OPTIONAL - when non-empty, pass --no-optional to pnpm
#   CDXGEN_SMOKE_TESTS         - extra shell snippet run after the install,
#                                e.g. "rbastgen --help && atom-tools --help"
#
# The smoke tests run with the same PATH the published cdxgen stage exposes,
# so they can invoke the node_modules and PYTHONPATH console scripts by name.

set -e

. "$(dirname "$0")/mirrors.sh"

mirrors_on

cd /opt/cdxgen
corepack enable
if [ -n "${CDXGEN_INSTALL_NO_OPTIONAL}" ]; then
  corepack pnpm install:prod --no-optional
else
  corepack pnpm install:prod
fi
corepack pnpm cache delete
rm -f /opt/cdxgen/pnpm-workspace.yaml
mkdir -p "${NODE_COMPILE_CACHE:-/opt/cdxgen-node-cache}"
node /opt/cdxgen/bin/cdxgen.js --help
if [ -n "${CDXGEN_SMOKE_TESTS}" ]; then
  PATH="${PATH}${PYTHONPATH:+:${PYTHONPATH}/bin}:/opt/cdxgen/node_modules/.bin"
  export PATH
  sh -c "${CDXGEN_SMOKE_TESTS}"
fi
rm -rf "${HOME}/.npmrc" "${HOME}/.pip" /root/.cache/node

mirrors_off

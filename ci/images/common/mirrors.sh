#! /bin/sh
# Shared mirror handling for the cdxgen container images.
#
# Source this file and call mirrors_on before any package installation that
# must go through the Nexus mirrors passed as build args, then mirrors_off
# afterwards to restore the upstream defaults. Only the mirrors that were
# actually set are touched, so the same file works for every distro flavour
# (alpine apk, debian apt) and language registry (npm, pip, rubygems).
#
# Build args consumed (all optional):
#   ALPINE_REPO      - apk repository mirror root, e.g. http://nexus:8081/repository/alpine
#   DEBIAN_REPO      - debian apt mirror root, e.g. http://nexus:8081/repository/debian
#   REDHAT_REPO      - ubi/microdnf repository mirror root (cdn-ubi.redhat.com)
#   NODEJS_DIST_URL  - nodejs.org dist mirror used by nvm and npm
#   NPM_REPO         - npm registry mirror
#   PIP_CONFIG       - full pip.conf contents (may contain \n escapes)
#   RUBYGEMS_REPO    - rubygems.org mirror root (no trailing slash needed)

APK_MIRROR_DEFAULT="https://dl-cdn.alpinelinux.org"
DEBIAN_MIRROR_DEFAULT="http://deb.debian.org"
DEBIAN_SECURITY_DEFAULT="http://security.debian.org/debian-security"
REDHAT_MIRROR_DEFAULT="https://cdn-ubi.redhat.com"
RUBYGEMS_DEFAULT="https://rubygems.org/"

# Track which files the npm/pip configuration created so mirrors_off can
# remove them again instead of leaving empty configuration behind.
NPMRC_FILE="${HOME}/.npmrc"
PIP_CONF_FILE="${HOME}/.pip/pip.conf"

mirrors_on() {
  if [ -n "${ALPINE_REPO}" ] && [ -f /etc/apk/repositories ]; then
    sed -i "s|${APK_MIRROR_DEFAULT}|${ALPINE_REPO}|g" /etc/apk/repositories
  fi
  if [ -n "${DEBIAN_REPO}" ]; then
    if [ -f /etc/apt/sources.list ]; then
      sed -i "s|${DEBIAN_MIRROR_DEFAULT}/debian|${DEBIAN_REPO}/debian|g" /etc/apt/sources.list
      sed -i "s|${DEBIAN_SECURITY_DEFAULT}|${DEBIAN_REPO}/debian-security|g" /etc/apt/sources.list
    fi
    if [ -f /etc/apt/sources.list.d/debian.sources ]; then
      sed -i "s|${DEBIAN_MIRROR_DEFAULT}|${DEBIAN_REPO}|g" /etc/apt/sources.list.d/debian.sources
    fi
  fi
  if [ -n "${NODEJS_DIST_URL}" ]; then
    export "NVM_NODEJS_ORG_MIRROR=${NODEJS_DIST_URL}"
    printf "disturl=%s\n" "${NODEJS_DIST_URL}" >> "${NPMRC_FILE}"
  fi
  if [ -n "${NPM_REPO}" ]; then
    export "COREPACK_NPM_REGISTRY=${NPM_REPO}"
    printf "registry=%s\n@jsr:registry=%s\n" "${NPM_REPO}" "${NPM_REPO}" >> "${NPMRC_FILE}"
  fi
  if [ -n "${PIP_CONFIG}" ]; then
    mkdir -p "${HOME}/.pip/"
    printf '%b' "${PIP_CONFIG}" > "${PIP_CONF_FILE}"
  fi
  if [ -n "${REDHAT_REPO}" ] && [ -d /etc/yum.repos.d ]; then
    sed -i "s|${REDHAT_MIRROR_DEFAULT}|${REDHAT_REPO}|g" /etc/yum.repos.d/*
  fi
  if [ -n "${RUBYGEMS_REPO}" ] && command -v gem >/dev/null 2>&1; then
    gem sources --add "${RUBYGEMS_REPO%/}/" --remove "${RUBYGEMS_DEFAULT}"
    gem sources -c
  fi
}

mirrors_off() {
  if [ -n "${RUBYGEMS_REPO}" ] && command -v gem >/dev/null 2>&1; then
    gem sources --add "${RUBYGEMS_DEFAULT}" --remove "${RUBYGEMS_REPO%/}/"
    gem sources -c
  fi
  rm -rf "${HOME}/.pip" "${NPMRC_FILE}"
  if [ -n "${REDHAT_REPO}" ] && [ -d /etc/yum.repos.d ]; then
    sed -i "s|${REDHAT_REPO}|${REDHAT_MIRROR_DEFAULT}|g" /etc/yum.repos.d/*
  fi
  if [ -n "${ALPINE_REPO}" ] && [ -f /etc/apk/repositories ]; then
    sed -i "s|${ALPINE_REPO}|${APK_MIRROR_DEFAULT}|g" /etc/apk/repositories
  fi
  if [ -n "${DEBIAN_REPO}" ]; then
    if [ -f /etc/apt/sources.list ]; then
      sed -i "s|${DEBIAN_REPO}/debian-security|${DEBIAN_SECURITY_DEFAULT}|g" /etc/apt/sources.list
      sed -i "s|${DEBIAN_REPO}/debian|${DEBIAN_MIRROR_DEFAULT}/debian|g" /etc/apt/sources.list
    fi
    if [ -f /etc/apt/sources.list.d/debian.sources ]; then
      sed -i "s|${DEBIAN_REPO}|${DEBIAN_MIRROR_DEFAULT}|g" /etc/apt/sources.list.d/debian.sources
    fi
  fi
}

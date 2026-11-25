#!/usr/bin/env bash
# On the 3D branch, deploy to the separate 3D site. The main 2D site (gh-pages of
# debojyoti10CC/exit-zero, exitzero.djyo.tech) is deployed from the main branch only.
exec bash "$(dirname "$0")/deploy-pages-3d.sh" "$@"

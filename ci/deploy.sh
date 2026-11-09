#!/usr/bin/env bash

VERSION=$(cat package.json | jq '.version' | xargs)

echo ${VERSION}

bash -c "./uploader dist_electron/sht-vr-player_${VERSION}_amd64.deb"

#!/bin/bash
DOCKER_REPO="rorylshanks"
DOCKER_IMAGE_NAME="sheevy"
TARGET_ARCHS="linux/amd64,linux/arm64"
docker buildx build --platform ${TARGET_ARCHS} -t ${DOCKER_REPO}/${DOCKER_IMAGE_NAME}:latest --push .
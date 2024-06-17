#!/bin/sh
kubectl -n distributed-computing create secret generic dc-secret --from-literal="valkey-password=$(uuidgen)"

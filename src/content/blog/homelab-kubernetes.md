---
title: "Running Kubernetes at Home: A Year of Production GitOps"
description: "What running a 116-pod Kubernetes cluster on Proxmox has taught me about infrastructure-as-code, GitOps, and where the real complexity lives."
date: 2025-09-03
tags: ["kubernetes", "infrastructure", "homelab", "DevOps"]
draft: true
---

I've been running a production-grade Kubernetes cluster at home since mid-2023. Not a single-node Kind cluster for learning — a multi-VM setup on Proxmox with 116 pods across services I actually depend on: password management, DNS, media, code hosting, and more. Everything is infrastructure-as-code. Nothing is click-ops.

This is what I've learned.

## Why Kubernetes at home?

The honest answer: I wanted to understand Kubernetes deeply enough to work with it professionally, and reading documentation and running toy examples wasn't cutting it. The only way to really understand a distributed system is to operate one — to deal with nodes that go down at inconvenient times, network policies that silently drop traffic, and storage that behaves differently than you expect.

Running services I actually use raises the stakes in a useful way. When Vaultwarden goes down, I can't log into things. When Technitium DNS stops resolving, my whole network breaks. That's a level of motivation that a "Hello World" Kubernetes deployment doesn't provide.

## The stack

**Hypervisor:** Proxmox VE. Six VMs total — a control plane node and five workers, distributed across two physical machines.

**VM provisioning:** Packer to build base VM templates (Ubuntu, cloud-init configured), Terraform to provision the actual VMs from those templates. Running `terraform apply` from scratch produces a fully configured cluster foundation in under 10 minutes.

**Kubernetes distribution:** Standard upstream Kubernetes via kubeadm. I chose this over K3s or Talos because I wanted to understand the full distribution, not a simplified version.

**GitOps:** ArgoCD. Every manifest lives in a git repo. ArgoCD polls the repo and reconciles the cluster to match. If I push a change to a deployment manifest, it's live within seconds. If something breaks and I revert the commit, the cluster self-heals.

**Ingress & TLS:** Traefik as the ingress controller, with cert-manager handling Let's Encrypt certificate issuance and renewal automatically. I have not manually renewed a TLS certificate in over a year.

**Observability:** Prometheus + Grafana for metrics. Loki for log aggregation. Alertmanager for... alerting.

## What GitOps actually means in practice

Before I ran GitOps properly, I had a cluster I couldn't fully explain. I'd made changes through `kubectl apply`, `helm upgrade`, and direct edits that weren't tracked anywhere. The cluster had state I couldn't reproduce.

ArgoCD solved this by making git the single source of truth. The discipline it enforces — all changes go through git — is the real value, not the tooling itself.

The concrete difference: when a node went down for kernel updates and came back with a wiped local volume, ArgoCD redeployed everything automatically from the manifests. I didn't have to figure out what was running on that node. The desired state was in git; ArgoCD reconciled to it.

**What this requires:** committing to a repository structure that ArgoCD can work with. I use the app-of-apps pattern: a root ArgoCD Application that manages a directory of Application manifests, each of which points to a subdirectory of the repo containing the actual workload manifests. Adding a new service means adding a directory and an Application manifest — ArgoCD picks it up automatically.

## Where the real complexity lives

Kubernetes documentation makes networking, storage, and RBAC sound manageable. Operating them in a real cluster teaches you why people have dedicated platform engineering teams.

**Networking:** CNI (I use Cilium) adds a layer between your pods and the network that you need to understand when things go wrong. Network policies are powerful and also easy to misconfigure in ways that silently drop traffic. I've spent more time debugging "why can't pod A reach pod B" than any other single problem class.

**Storage:** Kubernetes storage is one of the least intuitive parts of the system. PersistentVolumes, PersistentVolumeClaims, StorageClasses, CSI drivers — these are all necessary and none of them are simple. I use Longhorn for distributed block storage, which adds its own operational surface area. For stateful workloads, understanding what happens to your data when a node goes down is non-negotiable.

**Certificate and secret management:** cert-manager handles TLS automatically, which is excellent. Application secrets are a separate problem. I use Bitwarden Secrets Manager + the external-secrets operator to sync secrets into Kubernetes without storing them in git. Getting this right took longer than I expected.

## What I'd do differently

**Start with K3s.** If I were starting today, I'd use K3s or Talos rather than upstream Kubernetes with kubeadm. They're simpler to operate and the operational differences from upstream are small compared to the complexity they eliminate. I chose upstream because I wanted to learn it, which was the right call for my goals — but not necessary for running a homelab.

**Invest in observability earlier.** I added Prometheus + Grafana about six months in, after spending too much time debugging problems I couldn't measure. Good metrics and dashboards from the start would have paid off quickly.

**Use a proper secrets solution from day one.** I started with secrets in ConfigMaps (wrong) then moved to native Kubernetes Secrets stored in git (also wrong, they're just base64-encoded). Sorting this out retroactively was more work than doing it right initially.

## What it's worth

The homelab has made me significantly more effective working with Kubernetes professionally. When I provisioned 4-environment Azure infrastructure at Luminexis using Terraform and managed containerized workloads, the mental models were already solid. The tooling differed; the concepts didn't.

There's a version of this where you use managed Kubernetes (EKS, AKS, GKE) and let the cloud provider handle the hard parts. That's the right call for most production workloads. But understanding what those managed services are doing for you — what problems they're solving — requires having dealt with those problems yourself at least once.

The homelab is where I deal with those problems.

import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import * as ocean from "@pulumi/digitalocean";
import { provider, project } from "../cluster";
import { letsEncryptCerts } from "../certmanager";
import { ObjectMeta } from "../crd/meta/v1";
import { proxyService, apiService } from "../micro";

const conf = new pulumi.Config("digitalocean");
const cf = new pulumi.Config("m3o");

export const namespace = new k8s.core.v1.Namespace(
  "nginx",
  { metadata: { name: "nginx" } },
  { provider }
);

export const externalIP = new ocean.FloatingIp(
  "external-ip",
  {
    region: conf.require("region")
  },
  {
    parent: project
  }
);

export const externalChart = new k8s.helm.v3.Chart(
  "nginx",
  {
    chart: "ingress-nginx",
    version: "3.10.1",
    fetchOpts: {
      repo: "https://kubernetes.github.io/ingress-nginx"
    },
    namespace: namespace.metadata.name,
    values: {
      controller: {
        ingressClass: "external",
        metrics: {
          enabled: true
        },
        service: {
          loadBalancerIP: externalIP.ipAddress
        },
        admissionWebhooks: { enabled: false }
      }
    }
  },
  { provider, dependsOn: externalIP }
);

export const tailscaleCreds = new k8s.core.v1.Secret(
  "tailscale",
  {
    metadata: {
      namespace: namespace.metadata.name,
      name: "tailscale"
    },
    stringData: {
      auth_key: cf.require("tailscale_access_key")
    }
  },
  { provider }
);

export const pvc = new k8s.core.v1.PersistentVolumeClaim(
  "tailscale-state",
  {
    metadata: {
      name: "tailscale-nginx-ingress-state",
      namespace: namespace.metadata.name
    },
    spec: {
      accessModes: ["ReadWriteOnce"],
      resources: {
        requests: {
          storage: "1Gi"
        }
      }
    }
  },
  { provider }
);

export const internalChart = new k8s.helm.v3.Chart(
  "nginx-internal",
  {
    chart: "ingress-nginx",
    version: "3.9.0",
    fetchOpts: {
      repo: "https://kubernetes.github.io/ingress-nginx"
    },
    namespace: namespace.metadata.name,
    values: {
      controller: {
        updateStrategy: {
          type: "Recreate"
        },
        ingressClass: "internal",
        metrics: {
          enabled: true
        },
        service: {
          type: "ClusterIP"
        },
        admissionWebhooks: { enabled: false },
        extraVolumes: [
          {
            name: "tailscale-state",
            persistentVolumeClaim: {
              claimName: "tailscale-nginx-ingress-state"
            }
          }
        ],
        extraContainers: [
          {
            name: "nginx-ingress-tailscaled",
            image: "ghcr.io/m3o/tailscale:latest",
            imagePullPolicy: "Always",
            volumeMounts: [
              {
                name: "tailscale-state",
                mountPath: "/tailscale"
              }
            ],
            env: [
              {
                name: "TAILSCALE_AUTH",
                valueFrom: {
                  secretKeyRef: {
                    name: "tailscale",
                    key: "auth_key"
                  }
                }
              },
              {
                name: "TAILSCALE_TAGS",
                value: "tag:dev"
              }
            ],
            securityContext: {
              capabilities: {
                add: ["NET_ADMIN"]
              }
            }
          }
        ]
      }
    }
  },
  { provider, dependsOn: [externalIP, pvc] }
);

export const grpcIngress = new k8s.networking.v1beta1.Ingress(
  "grpc-ingress",
  {
    metadata: {
      name: "grpc-ingress",
      namespace: "server",
      annotations: {
        "kubernetes.io/ingress.class": "external",
        "nginx.ingress.kubernetes.io/backend-protocol": "GRPC",
        "cert-manager.io/cluster-issuer": (letsEncryptCerts.metadata as ObjectMeta)
          .name!
      }
    },
    spec: {
      tls: [
        {
          hosts: cf.require("proxy-hosts").split(","),
          secretName: "tls-proxy"
        }
      ],
      rules: cf
        .require("proxy-hosts")
        .split(",")
        .map(host => ({
          host,
          http: {
            paths: [
              {
                path: "/",
                pathType: "Prefix",
                backend: {
                  serviceName: "micro-proxy",
                  servicePort: 8081
                }
              }
            ]
          }
        }))
    }
  },
  { provider, dependsOn: [externalChart, proxyService] }
);

export const httpIngress = new k8s.networking.v1beta1.Ingress(
  "http-ingress",
  {
    metadata: {
      name: "http-ingress",
      namespace: "server",
      annotations: {
        "kubernetes.io/ingress.class": "external",
        "cert-manager.io/cluster-issuer": (letsEncryptCerts.metadata as ObjectMeta)
          .name!
      }
    },
    spec: {
      tls: [
        {
          hosts: cf.require("api-hosts").split(","),
          secretName: "tls-api"
        }
      ],
      rules: cf
        .require("api-hosts")
        .split(",")
        .map(host => ({
          host,
          http: {
            paths: [
              {
                path: "/",
                pathType: "Prefix",
                backend: {
                  serviceName: "micro-api",
                  servicePort: 8080
                }
              }
            ]
          }
        }))
    }
  },
  { provider, dependsOn: [externalChart, apiService] }
);

export const pr = new ocean.ProjectResources("pr-nginx", {
  project: project.id,
  resources: [externalIP.floatingIpUrn]
})


export default [
  internalChart,
  externalChart,
  externalIP,
  pvc,
  grpcIngress,
  httpIngress
];

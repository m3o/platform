import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import { provider } from "../cluster";
import * as crd from "../crd";

const conf = new pulumi.Config("m3o");

export const namespace = new k8s.core.v1.Namespace(
  "cert-manager",
  { metadata: { name: "cert-manager" } },
  { provider }
);

export const cfAPIKey = new k8s.core.v1.Secret(
  "cloudflare-api-key",
  {
    metadata: {
      namespace: namespace.metadata.name,
      name: "cloudflare-api-key"
    },
    stringData: { cloudflare: conf.require("cloudflare-api-key") }
  },
  { provider }
);

export const chart = new k8s.helm.v3.Chart(
  "certmanager",
  {
    namespace: namespace.metadata.name,
    chart: "cert-manager",
    version: "v1.0.3",
    fetchOpts: { repo: "https://charts.jetstack.io" },
    values: {
      installCRDs: true,
      prometheus: {
        enabled: true
      }
    }
  },
  { provider, dependsOn: cfAPIKey }
);

export const letsEncryptCerts = new crd.certmanager.v1.ClusterIssuer(
  "letsencryptcerts",
  {
    metadata: {
      name: "letsencrypt",
      namespace: namespace.metadata.name
    },
    spec: {
      acme: {
        server: "https://acme-v02.api.letsencrypt.org/directory",
        email: "support@m3o.com",
        privateKeySecretRef: {
          name: "letsencrypt"
        },
        solvers: [
          {
            dns01: {
              cloudflare: {
                email:  conf.require("cloudflare-email"),
                apiTokenSecretRef: {
                  name: cfAPIKey.metadata.name,
                  key: "cloudflare"
                }
              }
            }
          }
        ]
      }
    }
  },
  { provider, dependsOn: chart }
);

export const ca = new k8s.core.v1.Secret(
  "ca",
  {
    metadata: {
      namespace: namespace.metadata.name,
      name: "ca"
    },
    stringData: {
      "tls.crt": conf.require("ca-crt"),
      "tls.key": conf.require("ca-key")
    }
  },
  { provider, dependsOn: chart }
);

export const caCerts = new crd.certmanager.v1.ClusterIssuer(
  "ca-certs",
  {
    metadata: {
      name: "ca",
      namespace: namespace.metadata.name
    },
    spec: {
      ca: {
        secretName: "ca"
      }
    }
  },
  { provider, dependsOn: [chart, ca] }
);

export default [namespace, cfAPIKey, chart, letsEncryptCerts, ca, caCerts];

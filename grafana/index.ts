import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { K8SExec } from "../exec";
import { namespace } from "../monitoring";
import { provider, kubeconfig } from "../cluster";
import timescale, { namespace as tsNamespace } from "../timescale";
import { letsEncryptCerts } from "../certmanager";
import { ObjectMeta } from "../crd/meta/v1";
import { internalChart } from "../nginx";

const cf = new pulumi.Config("m3o");

export const database = new K8SExec(
  "grafana-db",
  {
    namespace: tsNamespace.metadata.name,
    podSelector: "role=master",
    container: "timescaledb",
    kubeConfig: kubeconfig,
    cmd: ["psql", "-c", "CREATE DATABASE grafana;"]
  },
  { dependsOn: timescale }
);

export const dataRetention = new K8SExec(
  "grafana-retention",
  {
    namespace: tsNamespace.metadata.name,
    podSelector: "role=master",
    container: "timescaledb",
    kubeConfig: kubeconfig,
    cmd: [
      "psql",
      "-d grafana",
      "-c",
      `SELECT set_default_retention_period(10 * INTERVAL '1 day')`
    ]
  },
  { dependsOn: timescale }
);


export const dbUser = new K8SExec(
  "grafana-user",
  {
    namespace: tsNamespace.metadata.name,
    podSelector: "role=master",
    container: "timescaledb",
    kubeConfig: kubeconfig,
    cmd: [
      "psql",
      "-c",
      `create user grafana with password '${cf
        .require("grafana_postgres_password")
        .toString()}';`
    ]
  },
  { dependsOn: timescale }
);

export const dbAccess = new K8SExec(
  "grafana-grant",
  {
    namespace: tsNamespace.metadata.name,
    podSelector: "role=master",
    container: "timescaledb",
    kubeConfig: kubeconfig,
    cmd: ["psql", "-c", `GRANT ALL PRIVILEGES ON DATABASE grafana TO grafana`]
  },
  { dependsOn: [...timescale, dbUser, database] }
);

export const creds = new k8s.core.v1.Secret(
  "grafana-credentials",
  {
    metadata: {
      namespace: namespace.metadata.name,
      name: "grafana-credentials"
    },
    stringData: {
      GF_DATABASE_TYPE: "postgres",
      GF_DATABASE_HOST: "timescale.timescale",
      GF_DATABASE_USER: "grafana",
      GF_DATABASE_NAME: "grafana",
      GF_DATABASE_SSL_MODE: "require",
      GF_DATABASE_PASSWORD: cf.require("grafana_postgres_password")
    }
  },
  { provider }
);

export const chart = new k8s.helm.v3.Chart(
  "grafana",
  {
    namespace: namespace.metadata.name,
    chart: "grafana",
    fetchOpts: { repo: "https://grafana.github.io/helm-charts", version: "6.1.9" },
    values: {
      envFromSecret: creds.metadata.name,
      adminUser: "admin",
      adminPassword: cf.require("grafana-admin-pass"),
      sidecar: {
        datasources: {
          enabled: true
        }
      },
      "grafana.ini": {
        server: { root_url: "https://grafana." + cf.require("internal-host") },
        "auth.google": {
          enabled: true,
          client_id: cf.require("google_oauth_client_id"),
          client_secret: cf.require("google_oauth_secret_id"),
          scopes:
            "https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/userinfo.email",
          auth_url: "https://accounts.google.com/o/oauth2/auth",
          token_url: "https://accounts.google.com/o/oauth2/token",
          allow_sign_up: true
        }
      }
    }
  },
  { provider, dependsOn: [...timescale, dbAccess] }
);

export const ingress = new k8s.networking.v1beta1.Ingress(
  "grafana-ingress",
  {
    metadata: {
      name: "grafana",
      namespace: namespace.metadata.name,
      annotations: {
        "kubernetes.io/ingress.class": "internal",
        "cert-manager.io/cluster-issuer": (letsEncryptCerts.metadata as ObjectMeta)
          .name!
      }
    },
    spec: {
      tls: [
        {
          hosts: ["grafana." + cf.require("internal-host")],
          secretName: "grafana-tls"
        }
      ],
      rules: [
        {
          host: "grafana." + cf.require("internal-host"),
          http: {
            paths: [
              {
                path: "/",
                pathType: "Prefix",
                backend: {
                  serviceName: "grafana",
                  servicePort: 3000
                }
              }
            ]
          }
        }
      ]
    }
  },
  { provider, dependsOn: internalChart }
);

export default [database, dbUser, dbAccess, creds, ingress];

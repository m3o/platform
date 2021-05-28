import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { namespace as tsNamespace, default as ts } from "../timescale";
import { kubeconfig, provider } from "../cluster";
import { K8SExec } from "../exec";

const conf = new pulumi.Config();

export const namespace = new k8s.core.v1.Namespace(
  "monitoring",
  { metadata: { name: "monitoring" } },
  { provider }
);

export const database = new K8SExec(
  "analytics-db",
  {
    namespace: tsNamespace.metadata.name,
    podSelector: "role=master",
    container: "timescaledb",
    kubeConfig: kubeconfig,
    cmd: ["psql", "-c", "CREATE DATABASE analytics;"]
  },
  { dependsOn: ts }
);

export const dataRetention = new K8SExec(
  "analytics-retention",
  {
    namespace: tsNamespace.metadata.name,
    podSelector: "role=master",
    container: "timescaledb",
    kubeConfig: kubeconfig,
    cmd: [
      "psql",
      "-d analytics",
      "-c",
      `SELECT set_default_retention_period(10 * INTERVAL '1 day')`
    ]
  },
  { dependsOn: ts }
);

export const dbUser = new K8SExec(
  "analytics-user",
  {
    namespace: tsNamespace.metadata.name,
    podSelector: "role=master",
    container: "timescaledb",
    kubeConfig: kubeconfig,
    cmd: [
      "psql",
      "-c",
      `create user analytics with password '${conf
        .require("analytics_db_password")
        .toString()}';`
    ]
  },
  { dependsOn: ts }
);

export const dbAccessAnalytics = new K8SExec(
  "analytics-grant",
  {
    namespace: tsNamespace.metadata.name,
    podSelector: "role=master",
    container: "timescaledb",
    kubeConfig: kubeconfig,
    cmd: [
      "psql",
      "-c",
      `GRANT ALL PRIVILEGES ON DATABASE analytics TO analytics`
    ]
  },
  { dependsOn: [...ts, dbUser] }
);

export default [namespace, database, dbUser, dbAccessAnalytics];

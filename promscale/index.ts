import * as k8s from '@pulumi/kubernetes';
import * as pulumi from '@pulumi/pulumi';
import { K8SExec } from '../exec';
import { namespace as tsNamespace, default as ts } from '../timescale';
import monitoring, { namespace } from '../monitoring';
import { kubeconfig, provider } from '../cluster';

const cf = new pulumi.Config("m3o");

export const dbUser = new K8SExec(
  "promscale-user",
  {
    namespace: tsNamespace.metadata.name,
    podSelector: "role=master",
    container: "timescaledb",
    kubeConfig: kubeconfig,
    cmd: [
      "psql",
      "-c",
      `create user promscale with password '${cf
        .require("promscale_postgres_password")
        .toString()}' SUPERUSER;`
    ]
  },
  { dependsOn: [...ts, ...monitoring] }
);

export const dbAccess = new K8SExec(
  "promscale-grant",
  {
    namespace: tsNamespace.metadata.name,
    podSelector: "role=master",
    container: "timescaledb",
    kubeConfig: kubeconfig,
    cmd: [
      "psql",
      "-c",
      `GRANT ALL PRIVILEGES ON DATABASE analytics TO promscale`
    ]
  },
  { dependsOn: [...ts, ...monitoring, dbUser] }
);

export const creds = new k8s.core.v1.Secret(
  "promscale-credentials",
  {
    metadata: {
      namespace: namespace.metadata.name,
      name: "promscale-timescaledb-passwords"
    },
    stringData: {
      promscale: cf.require("promscale_postgres_password")
    }
  },
  { provider }
);

export const chart = new k8s.helm.v3.Chart(
  "promscale",
  {
    namespace: namespace.metadata.name,
    chart: "promscale",
    fetchOpts: { repo: "https://charts.timescale.com", "version": "0.1.2" },
    values: {
      image: "timescale/promscale:0.1.2",
      connection: {
        user: "promscale",
        host: { nameTemplate: "timescale.timescale" },
        password: { secretTemplate: creds.metadata.name },
        dbName: "analytics"
      },
      service: {
        loadBalancer: { enabled: false }
      }
    }
  },
  { provider, dependsOn: [...ts, dbUser, dbAccess] }
);

export default [
  dbUser,
  dbAccess,
  creds,
  chart,
]

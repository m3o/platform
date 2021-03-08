import * as pulumi from "@pulumi/pulumi";
import * as ocean from "@pulumi/digitalocean";
import * as k8s from "@pulumi/kubernetes";
import { project, provider } from "../cluster";
import * as crd from "../crd";

const cf = new pulumi.Config("m3o");
const conf = new pulumi.Config("digitalocean");

export const namespace = new k8s.core.v1.Namespace(
  "timescale",
  { metadata: { name: "timescale" } },
  { provider }
);

export const tls = new crd.certmanager.v1.Certificate(
  "timescale-tls",
  {
    metadata: {
      name: "timescale-tls",
      namespace: namespace.metadata.name
    },
    spec: {
      secretName: "timescale-tls",
      subject: {
        organizations: ["m3o"]
      },
      isCA: false,
      privateKey: {
        algorithm: "ECDSA",
        size: 256
      },
      dnsNames: ["timescale.timescale.svc.cluster.local", "timescale"],
      issuerRef: {
        name: "ca",
        kind: "ClusterIssuer"
      }
    }
  },
  { provider }
);

export const creds = new k8s.core.v1.Secret(
  "timescale-credentials",
  {
    metadata: {
      namespace: namespace.metadata.name
    },
    stringData: {
      PATRONI_SUPERUSER_PASSWORD: cf.require("patroni_superuser_password"),
      PATRONI_REPLICATION_PASSWORD: cf.require("patroni_replication_password"),
      PATRONI_admin_PASSWORD: cf.require("patroni_admin_password")
    }
  },
  { provider }
);

export const chart = new k8s.helm.v3.Chart(
  "timescale",
  {
    namespace: namespace.metadata.name,
    chart: "timescaledb-single",
    fetchOpts: { repo: "https://charts.timescale.com", version: "0.7.1" },
    values: {
      image: { tag: "pg12.4-ts1.7.4-p1" },
      replicaCount: 2,
      loadBalancer: {
        enabled: false
      },
      prometheus: { enabled: true },
      rbac: {
        enabled: true
      },
      secretNames: {
        credentials: creds.metadata.name,
        certificate: tls.spec.secretName,
      },
      patroni: {
        postgresql: {
          parameters: {
            max_wal_size: "16GB",
            min_wal_size: "10GB",
            shared_buffers: "1GB",
            work_mem: "64MB"
          }
        },
        bootstrap: {
          method: "restore_or_initdb",
          restore_or_initdb: {
            command:
              "/etc/timescaledb/scripts/restore_or_initdb.sh --encoding=UTF8 --locale=C.UTF-8 --wal-segsize=256\n"
          },
          dcs: {
            synchronous_mode: true,
            master_start_timeout: 0,
            postgresql: {
              use_slots: false,
              parameters: {
                checkpoint_timeout: "300s",
                temp_file_limit: "10GB",
                synchronous_commit: "remote_apply"
              }
            }
          }
        }
      },
      backup: {
        enabled: false,
      },
      persistentVolumes: {
        data: {
          enabled: true,
          size: "150Gi"
        },
        wal: {
          enabled: true,
          size: "20Gi"
        }
      }
    }
  },
  { provider }
);

export default [namespace, tls, creds];

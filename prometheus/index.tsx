import * as k8s from "@pulumi/kubernetes";
import { provider } from "../cluster";
import { namespace } from "../monitoring";
import promscale from "../promscale";
import * as YAML from "yamljs";
import * as crd from "../crd";

// export const chart = new k8s.helm.v3.Chart(
//   "prometheus",
//   {
//     namespace: namespace.metadata.name,
//     chart: "prometheus",
//     repo: "stable",
//     values: {
//       alertmanager: { enabled: false },
//       pushgateway: { enabled: false },
//       extraScrapeConfigs: `
// remote_write:
//   - url: "http://promscale-connector.monitoring:9201/write"
// remote_read:
//   - url: "http://promscale-connector.monitoring:9201/read"`
//     }
//   },
//   { provider, dependsOn: promscale },
// );
//

// export const chart = new k8s.helm.v3.Chart(
//   "prometheus",
//   {
//     namespace: namespace.metadata.name,
//     chart: "kube-prometheus-stack",
//     fetchOpts: { repo: "https://prometheus-community.github.io/helm-charts" },
//     values: {
//       namespaceOverride: "monitoring"
//       // grafana: { enabled: false }
//       // extraScrapeConfigs: `
//       // remote_write:
//       // - url: "http://promscale-connector.monitoring:9201/write"
//       // remote_read:
//       // - url: "http://promscale-connector.monitoring:9201/read"`
//     }
//   },
//   { provider, dependsOn: promscale }
// );

// Has namespace of monitoring hardcoded
const operator = new k8s.yaml.ConfigFile(
  "prometheus-operator",
  {
    file: "./prometheus/bundle.yaml"
  },
  { provider }
);

const promSA = new k8s.core.v1.ServiceAccount(
  "prometheus-sa",
  {
    metadata: { name: "prometheus", namespace: "monitoring" }
  },
  { provider }
);

const promRBAC = new k8s.rbac.v1.ClusterRole(
  "prometheus-cr",
  {
    metadata: {
      name: "prometheus"
    },
    rules: [
      {
        apiGroups: [""],
        resources: ["nodes", "nodes/metrics", "services", "endpoints", "pods"],
        verbs: ["get", "list", "watch"]
      },
      {
        apiGroups: [""],
        resources: ["configmaps"],
        verbs: ["get"]
      },
      {
        apiGroups: ["networking.k8s.io"],
        resources: ["ingresses"],
        verbs: ["get", "list", "watch"]
      },
      {
        nonResourceURLs: ["/metrics"],
        verbs: ["get"]
      }
    ]
  },
  { provider }
);

const promcrb = new k8s.rbac.v1.ClusterRoleBinding(
  "prometheus-crb",
  {
    metadata: {
      name: "prometheus"
    },
    roleRef: {
      apiGroup: "rbac.authorization.k8s.io",
      kind: "ClusterRole",
      name: "prometheus"
    },
    subjects: [
      {
        kind: "ServiceAccount",
        name: "prometheus",
        namespace: "monitoring"
      }
    ]
  },
  { provider }
);

// One alertmanager is shared amongst N proms
export const alertmanager = new crd.monitoring.v1.Alertmanager(
  "alertmanager",
  {
    metadata: { namespace: "monitoring", name: "alertmanager" },
    spec: { replicas: 2 }
  },
  { provider }
);

const prom = new crd.monitoring.v1.Prometheus(
  "prometheus-infra",
  {
    metadata: { name: "prometheus-infra", namespace: "monitoring" },
    spec: {
      alerting: {
        alertmanagers: [
          { namespace: "monitoring", name: "alertmanager", port: "web" }
        ]
      },
      serviceAccountName: "prometheus",
      serviceMonitorSelector: { matchLabels: { prometheus: "infra" } },
      serviceMonitorNamespaceSelector: { matchLabels: { prometheus: "infra" } },
      podMonitorSelector: { matchLabels: { prometheus: "infra" } },
      podMonitorNamespaceSelector: { matchLabels: { prometheus: "infra" } },
      ruleSelector: { matchLabels: { prometheus: "infra" } },
      ruleNamespaceSelector: { matchLabels: { prometheus: "infra" } },
      retention: "1d",
      storage: {
        volumeClaimTemplate: {
          spec: { resources: { requests: { storage: "20Gi" } } }
        }
      },
      securityContext: {
        fsGroup: 2000,
        runAsNonRoot: true,
        runAsUser: 1000
      }
    }
  },
  { provider, dependsOn: [promSA] }
);

export const svc = new k8s.core.v1.Service(
  "prometheus-infra",
  {
    metadata: { namespace: "monitoring", name: "prometheus-infra" },
    spec: {
      ports: [
        {
          name: "http",
          port: 80,
          protocol: "TCP",
          targetPort: "web"
        }
      ],
      selector: {
        prometheus: "prometheus-infra"
      }
    }
  },
  { provider }
);

const datasource = YAML.stringify({
  apiVersion: 1,
  datasources: [
    {
      name: "Prometheus Infrastructure",
      type: "prometheus",
      access: "proxy",
      url: "http://prometheus-infra"
    }
  ]
});

export const configMap = new k8s.core.v1.ConfigMap(
  "prometheus-grafana",
  {
    metadata: {
      name: "prometheus-grafana",
      namespace: namespace.metadata.name,
      labels: {
        app: "prometheus",
        grafana_datasource: "1"
      }
    },
    data: {
      "prometheus-datasource.yaml": datasource
    }
  },
  { provider }
);

export default [operator, prom, promSA, promRBAC, promcrb, configMap];

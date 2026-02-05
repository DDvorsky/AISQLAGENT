# AISQLAGENT - Kubernetes Deployment

## Prerequisites

- Kubernetes cluster (any distribution: K3s, K8s, EKS, AKS, GKE)
- `kubectl` configured to access the cluster
- StorageClass available for PersistentVolumeClaim

---

## Quick Deployment

### 1. Create Namespace (optional)

```bash
kubectl create namespace aisqlagent
```

### 2. Apply Manifests

```bash
# From the k8s directory
kubectl apply -f k8s/deployment.yaml -n aisqlagent

# Or from URL
kubectl apply -f https://raw.githubusercontent.com/DDvorsky/AISQLAGENT/main/k8s/deployment.yaml -n aisqlagent
```

### 3. Verify Deployment

```bash
kubectl get pods -n aisqlagent
kubectl get pvc -n aisqlagent
kubectl get svc -n aisqlagent
```

---

## Access the UI

### Option A: Port Forward (for testing)

```bash
kubectl port-forward svc/aisqlagent 3333:3000 -n aisqlagent
# Then open http://localhost:3333
```

### Option B: LoadBalancer (cloud)

Edit the service type:
```yaml
spec:
  type: LoadBalancer
  ports:
  - port: 80
    targetPort: 3000
```

### Option C: Ingress

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: aisqlagent
  namespace: aisqlagent
  annotations:
    nginx.ingress.kubernetes.io/ssl-redirect: "true"
spec:
  ingressClassName: nginx
  rules:
  - host: agent.example.com
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: aisqlagent
            port:
              number: 3000
  tls:
  - hosts:
    - agent.example.com
    secretName: agent-tls
```

---

## Configuration

### First-time Setup

1. Access the UI via port-forward or ingress
2. Upload `init.json` (downloaded from AISQLWatch)
3. Pod will restart automatically
4. Login with password
5. Configure SQL Server

### Persistent Storage

The deployment uses a PVC to store:
- `init.json` - Server connection config
- `sql-config.json` - SQL Server credentials
- `auth-config.json` - Auth state

**Verify PVC is bound:**
```bash
kubectl get pvc aisqlagent-config -n aisqlagent
```

---

## Manifest Reference

```yaml
# deployment.yaml contains:
# - PersistentVolumeClaim (100Mi for config)
# - Deployment (1 replica)
# - Service (ClusterIP on port 3000)
```

### Full Deployment YAML

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: aisqlagent-config
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 100Mi
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: aisqlagent
spec:
  replicas: 1
  selector:
    matchLabels:
      app: aisqlagent
  template:
    metadata:
      labels:
        app: aisqlagent
    spec:
      containers:
      - name: agent
        image: registry.danyverse.com/aisqlwatch/agent:latest
        ports:
        - containerPort: 3000
        env:
        - name: CONFIG_PATH
          value: "/app/config/init.json"
        volumeMounts:
        - name: config
          mountPath: /app/config
        resources:
          requests:
            memory: "128Mi"
            cpu: "100m"
          limits:
            memory: "256Mi"
            cpu: "500m"
      volumes:
      - name: config
        persistentVolumeClaim:
          claimName: aisqlagent-config
---
apiVersion: v1
kind: Service
metadata:
  name: aisqlagent
spec:
  selector:
    app: aisqlagent
  ports:
  - port: 3000
    targetPort: 3000
```

---

## Connecting to SQL Server

### SQL Server in Same Cluster

Use the service DNS name:
```
Server: sqlserver.namespace.svc.cluster.local
Port: 1433
```

### SQL Server Outside Cluster

Use the external IP/hostname:
```
Server: sql.company.com
Port: 1433
```

### Azure SQL / AWS RDS

```
Server: your-server.database.windows.net
Port: 1433
Encrypt: true
```

---

## Useful Commands

```bash
# View logs
kubectl logs -f deployment/aisqlagent -n aisqlagent

# Restart deployment
kubectl rollout restart deployment/aisqlagent -n aisqlagent

# Check config files in pod
kubectl exec -it deployment/aisqlagent -n aisqlagent -- ls -la /app/config

# Copy init.json to pod manually
kubectl cp init.json aisqlagent/<pod-name>:/app/config/init.json -n aisqlagent

# Delete and recreate (PVC preserves data)
kubectl delete deployment aisqlagent -n aisqlagent
kubectl apply -f k8s/deployment.yaml -n aisqlagent
```

---

## Troubleshooting

### Pod stuck in Pending

Check if PVC is bound:
```bash
kubectl describe pvc aisqlagent-config -n aisqlagent
```

May need to configure StorageClass.

### Pod CrashLoopBackOff

Check logs:
```bash
kubectl logs deployment/aisqlagent -n aisqlagent --previous
```

### Cannot pull image

Add imagePullSecrets to deployment or use public image.

### SQL connection timeout

- Verify SQL Server is reachable from the cluster
- Check Network Policies
- Ensure firewall allows traffic from cluster

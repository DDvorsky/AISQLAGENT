# AISQLAGENT - OpenShift Deployment

## Prerequisites

- OpenShift cluster (OCP 4.x or OKD)
- `oc` CLI configured and logged in
- Project (namespace) with appropriate quotas

---

## Quick Deployment

### 1. Create Project

```bash
oc new-project aisqlagent
```

### 2. Apply Manifests

```bash
oc apply -f k8s/deployment.yaml
```

Or deploy directly:

```bash
oc new-app --name=aisqlagent \
  --docker-image=registry.danyverse.com/aisqlwatch/agent:latest \
  -e CONFIG_PATH=/app/config/init.json

# Create PVC
oc set volume deployment/aisqlagent \
  --add --name=config \
  --type=pvc \
  --claim-name=aisqlagent-config \
  --claim-size=100Mi \
  --mount-path=/app/config
```

### 3. Expose Route

```bash
oc expose svc/aisqlagent
# Or with TLS
oc create route edge aisqlagent --service=aisqlagent --port=3000
```

### 4. Get URL

```bash
oc get route aisqlagent -o jsonpath='{.spec.host}'
```

---

## OpenShift-Specific Configuration

### Security Context Constraints (SCC)

The agent runs as non-root user (UID 1001). If you encounter permission issues:

```bash
# Check current SCC
oc get pod -o yaml | grep -i scc

# Use restricted SCC (default, should work)
oc adm policy add-scc-to-user restricted -z default
```

### DeploymentConfig (OpenShift native)

If you prefer OpenShift DeploymentConfig over Kubernetes Deployment:

```yaml
apiVersion: apps.openshift.io/v1
kind: DeploymentConfig
metadata:
  name: aisqlagent
spec:
  replicas: 1
  selector:
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
  triggers:
  - type: ConfigChange
```

---

## Complete OpenShift Manifest

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
  labels:
    app: aisqlagent
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
      securityContext:
        runAsNonRoot: true
      containers:
      - name: agent
        image: registry.danyverse.com/aisqlwatch/agent:latest
        imagePullPolicy: Always
        ports:
        - containerPort: 3000
        env:
        - name: NODE_ENV
          value: "production"
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
        securityContext:
          allowPrivilegeEscalation: false
          capabilities:
            drop:
              - ALL
        livenessProbe:
          httpGet:
            path: /api/status
            port: 3000
          initialDelaySeconds: 10
          periodSeconds: 30
        readinessProbe:
          httpGet:
            path: /api/status
            port: 3000
          initialDelaySeconds: 5
          periodSeconds: 10
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
---
apiVersion: route.openshift.io/v1
kind: Route
metadata:
  name: aisqlagent
spec:
  to:
    kind: Service
    name: aisqlagent
  port:
    targetPort: 3000
  tls:
    termination: edge
    insecureEdgeTerminationPolicy: Redirect
```

---

## Configuration Steps

### 1. Deploy

```bash
oc apply -f openshift-deployment.yaml
```

### 2. Get Route URL

```bash
echo "https://$(oc get route aisqlagent -o jsonpath='{.spec.host}')"
```

### 3. Upload init.json

Open the URL in browser and upload the init.json file.

### 4. Configure SQL Server

After restart and login, configure SQL connection.

---

## Image Registry Setup

### Using Internal Registry

```bash
# Tag and push to internal registry
oc registry login
docker tag aisqlagent:local $(oc registry info)/aisqlagent/agent:latest
docker push $(oc registry info)/aisqlagent/agent:latest

# Update deployment to use internal image
oc set image deployment/aisqlagent agent=$(oc registry info)/aisqlagent/agent:latest
```

### Using External Registry with Pull Secret

```bash
oc create secret docker-registry registry-creds \
  --docker-server=registry.danyverse.com \
  --docker-username=your-username \
  --docker-password=your-password

oc secrets link default registry-creds --for=pull
```

---

## Useful Commands

```bash
# View logs
oc logs -f deployment/aisqlagent

# Restart deployment
oc rollout restart deployment/aisqlagent

# Scale (for zero-downtime redeploy)
oc scale deployment/aisqlagent --replicas=0
oc scale deployment/aisqlagent --replicas=1

# Access pod shell
oc rsh deployment/aisqlagent

# View config files
oc rsh deployment/aisqlagent ls -la /app/config

# Port forward for local testing
oc port-forward svc/aisqlagent 3333:3000

# Check route TLS
oc get route aisqlagent -o yaml | grep -A5 tls
```

---

## Troubleshooting

### Permission Denied Errors

```bash
# Check SCC
oc describe pod $(oc get pod -l app=aisqlagent -o name | head -1)

# Agent runs as UID 1001 - should work with restricted SCC
```

### PVC Not Binding

```bash
# Check available storage classes
oc get sc

# Check PVC status
oc describe pvc aisqlagent-config
```

### Route Not Working

```bash
# Check route status
oc describe route aisqlagent

# Verify service endpoints
oc get endpoints aisqlagent
```

### Image Pull Error

```bash
# Check image pull secrets
oc get secrets | grep registry

# Verify image exists
skopeo inspect docker://registry.danyverse.com/aisqlwatch/agent:latest
```

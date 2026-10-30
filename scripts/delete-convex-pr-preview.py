#!/usr/bin/env python3
"""Delete the Convex preview for a closed Code PR, if it exists."""
import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request

number = os.environ["PR_NUMBER"]
if not re.fullmatch(r"[1-9][0-9]*", number):
    raise ValueError("Invalid PR number")
reference = f"preview/code-pr-{number}"
token = os.environ["CONVEX_MANAGEMENT_TOKEN"]
base = "https://api.convex.dev/v1"
headers = {"Authorization": f"Bearer {token}"}
url = f"{base}/teams/v5x/projects/sloppier-v5x/deployment?" + urllib.parse.urlencode({"reference": reference})
try:
    with urllib.request.urlopen(urllib.request.Request(url, headers=headers)) as response:
        deployment = json.load(response)
except urllib.error.HTTPError as error:
    if error.code == 404:
        print(f"No Convex preview for {reference}")
        raise SystemExit(0)
    raise
if deployment.get("deploymentType") != "preview" or deployment.get("reference") != reference or deployment.get("projectId") != 3278431:
    raise ValueError("Convex deployment does not match the expected preview")
name = deployment["name"]
if not re.fullmatch(r"[a-z0-9-]+", name):
    raise ValueError("Invalid deployment name")
request = urllib.request.Request(f"{base}/deployments/{name}/delete", headers=headers, method="POST")
with urllib.request.urlopen(request) as response:
    print(f"Deleted {reference}: HTTP {response.status}")

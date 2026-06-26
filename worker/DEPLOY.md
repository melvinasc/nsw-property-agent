# Deploy Cloudflare Worker (10 minutes, free)

## Step 1 — Create a free Cloudflare account
1. Go to https://cloudflare.com
2. Click **Sign Up** — just email + password, no credit card needed

## Step 2 — Deploy the Worker via Cloudflare Dashboard (no terminal needed)

1. Log in to https://dash.cloudflare.com
2. Click **Workers & Pages** in the left sidebar
3. Click **Create Application**
4. Click **Create Worker**
5. Give it the name: `nsw-property-proxy`
6. Click **Deploy**
7. Click **Edit code**
8. **Select all** the code in the editor and **delete it**
9. Copy and paste the entire contents of `worker.js` (from this folder)
10. Click **Save and Deploy**

## Step 3 — Get your Worker URL

After deploying, Cloudflare gives you a URL like:
```
https://nsw-property-proxy.YOUR_NAME.workers.dev
```
Copy this URL.

## Step 4 — Update your app

1. Open `js/data.js` in your GitHub repo
2. Find line 1 at the top:
```js
const PROXY_URL = "https://nsw-property-proxy.YOUR_NAME.workers.dev";
```
3. Replace `YOUR_NAME` with your actual Cloudflare username
4. Commit the change

## Step 5 — Done!

Your app now fetches from Domain, Homely, property.com.au and realestate.com.au
through the Worker — zero CORS issues, all free.

## Free tier limits
- 100,000 requests per day
- Resets at midnight UTC
- No credit card ever needed

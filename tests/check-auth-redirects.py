"""Read only the non-secret redirect settings for the isolated 2027 project."""
import json, os, urllib.request
key = os.environ.get('SUPABASE_ACCESS_TOKEN')
if not key:
    print('AUTH_REDIRECT_CHECK: management credential unavailable')
else:
    req = urllib.request.Request('https://api.supabase.com/v1/projects/xspzmthygrajzktydvvj/config/auth', headers={'Authorization':'Bearer '+key})
    with urllib.request.urlopen(req,timeout=30) as response:
        config=json.load(response)
    print('AUTH_REDIRECT_CHECK: '+json.dumps({k:config.get(k) for k in ['site_url','uri_allow_list','mailer_autoconfirm','disable_signup','external_email_enabled']}))

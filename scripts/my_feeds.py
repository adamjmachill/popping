#!/usr/bin/env python3
"""Personal feed setup for a running Popping instance.

Run on the server (stdlib only):

    python3 my_feeds.py [--skip-reddit] [--pause-google]

Talks to the app's own API on localhost. Each feed is probed with
/api/sources/test before it's added, so a dead or blocking URL is
reported and skipped instead of becoming a broken column. Sources
that already exist (by name) are left alone, so re-running is safe.
"""

import json
import sys
import time
import urllib.error
import urllib.request

API = "http://127.0.0.1:14789/api"

# Some CDNs (CBC among them) reject the app's default User-Agent.
BROWSER_UA = {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/130.0 Safari/537.36"
}


def gnews(query):
    """Google News search feed, Canadian edition."""
    return f"https://news.google.com/rss/search?q={query}&hl=en-CA&gl=CA&ceid=CA:en"


# (name, type, category, url, refresh_seconds, custom_headers)
FEEDS = [
    # Macro, rates, markets
    ("bank_of_canada", "rss", "markets", "https://www.bankofcanada.ca/content_type/press-releases/feed/", 3600, None),
    ("fed_press", "rss", "markets", "https://www.federalreserve.gov/feeds/press_all.xml", 3600, None),
    ("statcan_daily", "rss", "markets", gnews("%22Statistics+Canada%22+OR+StatCan"), 3600, None),
    ("cbc_business", "rss", "markets", "https://www.cbc.ca/webfeed/rss/rss-business", 3600, BROWSER_UA),
    ("cnbc_top", "rss", "markets", "https://www.cnbc.com/id/100003114/device/rss/rss.html", 3600, None),
    ("marketwatch_top", "rss", "markets", "https://feeds.content.dowjones.io/public/rss/mw_topstories", 3600, None),
    ("r_canadianinvestor", "reddit", "markets", "r/CanadianInvestor", 1800, None),
    ("r_economics", "reddit", "markets", "r/Economics", 1800, None),
    # Commodities and Selkirk Copper
    ("selkirk_copper_news", "rss", "commodities", gnews("%22Selkirk+Copper%22"), 3600, None),
    ("copper_news", "rss", "commodities", gnews("copper+price+OR+%22copper+futures%22"), 3600, None),
    ("oil_news", "rss", "commodities", gnews("%22crude+oil%22+price+OR+%22oil+futures%22"), 3600, None),
    ("mining_com", "rss", "commodities", "https://www.mining.com/feed/", 3600, BROWSER_UA),
    ("selkirk_releases", "rss", "commodities", "https://feeds.newsfilecorp.com/company/11605", 3600, None),
    ("selkirk_copper_yt", "youtube_channel", "commodities", "https://www.youtube.com/@SelkirkCopperMines", 3600, None),
    ("eia_press", "rss", "commodities", "https://www.eia.gov/rss/press_rss.xml", 3600, None),
    ("oilprice_com", "rss", "commodities", "https://oilprice.com/rss/main", 3600, None),
    # BC and federal policy, budget, tax
    ("bc_gov_news", "rss", "policy", gnews("site:news.gov.bc.ca"), 3600, None),
    ("bc_budget_tax", "rss", "policy", gnews("%22B.C.%22+budget+OR+tax+OR+%22finance+minister%22"), 3600, None),
    ("canada_budget_tax", "rss", "policy", gnews("%22federal+budget%22+OR+%22Department+of+Finance+Canada%22+OR+CRA+tax+Canada"), 3600, None),
    ("r_britishcolumbia", "reddit", "policy", "r/britishcolumbia", 1800, None),
    # CFO career, accounting profession, starting a business
    ("cpa_canada_bc", "rss", "career", gnews("%22CPA+Canada%22+OR+%22CPA+BC%22"), 3600, None),
    ("big4_canada_tax", "rss", "career", gnews("Canada+tax+Deloitte+OR+KPMG+OR+EY+OR+PwC"), 3600, None),
    ("fractional_cfo", "rss", "career", gnews("%22fractional+CFO%22"), 3600, None),
    ("board_presence", "rss", "career", gnews("%22executive+presence%22+OR+%22board+presentation%22+CFO"), 3600, None),
    ("r_fpanda", "reddit", "career", "r/FPandA", 1800, None),
    ("r_accounting", "reddit", "career", "r/Accounting", 1800, None),
    ("r_smallbusiness", "reddit", "career", "r/smallbusiness", 1800, None),
    # AI and Claude
    ("anthropic_yt", "youtube_channel", "ai", "https://www.youtube.com/@anthropic-ai", 3600, None),
    ("claude_news", "rss", "ai", gnews("Anthropic+Claude"), 3600, None),
    ("ai_in_finance", "rss", "ai", gnews("AI+CFO+OR+accountants+OR+%22finance+teams%22"), 3600, None),
    ("r_claudeai", "reddit", "ai", "r/ClaudeAI", 1800, None),
    # ERP and accounting software
    ("acumatica_news", "rss", "erp", gnews("Acumatica"), 3600, None),
    ("epicor_news", "rss", "erp", gnews("Epicor+ERP"), 3600, None),
    ("quickbooks_online_news", "rss", "erp", gnews("%22QuickBooks+Online%22"), 3600, None),
    ("other_erp_news", "rss", "erp", gnews("NetSuite+OR+%22Sage+Intacct%22+OR+%22Business+Central%22+OR+Xero+ERP"), 3600, None),
    ("firm_of_the_future", "rss", "erp", "https://www.firmofthefuture.com/feed/", 3600, BROWSER_UA),
    ("cpa_practice_advisor", "rss", "erp", "https://www.cpapracticeadvisor.com/feed/", 3600, BROWSER_UA),
    ("accounting_today_tech", "rss", "erp", gnews("site:accountingtoday.com+technology"), 3600, None),
    # Football
    ("fantasy_footballers_yt", "youtube_channel", "football", "https://www.youtube.com/@TheFantasyFootballers", 3600, None),
    ("r_fantasyfootball", "reddit", "football", "r/fantasyfootball", 900, None),
    ("r_sportsbook", "reddit", "football", "r/sportsbook", 1800, None),
]

# Primary sources from "My Source List" (Oct 17, 2026). Most are
# pages rather than feeds, so they go through /api/sources/auto, which
# finds the site's feed or falls back to sitemap scraping. The created
# row is renamed to the name here so re-runs can tell it already exists.
# (name, category, page url)
AUTO_FEEDS = [
    # Fractional CFO, boards, the profession, starting a business
    ("icd_director_lens", "career", "https://www.icd.ca/Insights/Director-Lens"),
    ("hbr_presentation_skills", "career", "https://hbr.org/topic/subject/presentation-skills"),
    ("cpabc_news", "career", "https://www.bccpa.ca/news-events/publications"),
    ("cpa_canada", "career", "https://www.cpacanada.ca"),
    ("ey_tax_alerts_ca", "career", "https://ey.com/en_ca/tax/tax-alerts"),
    ("kpmg_taxnewsflash_ca", "career", "https://kpmg.com/ca/en/home/services/tax/tax-news-flash-canada.html"),
    ("small_business_bc", "career", "https://smallbusinessbc.ca"),
    ("bdc_advice", "career", "https://www.bdc.ca/en/articles-tools"),
    # Macro and markets
    ("statcan_the_daily", "markets", "https://www150.statcan.gc.ca/n1/dai-eng.htm"),
    ("rbc_economics", "markets", "https://thoughtleadership.rbc.com/economics/"),
    ("bnn_bloomberg", "markets", "https://www.bnnbloomberg.ca"),
    ("oaktree_memos", "markets", "https://www.oaktreecapital.com/insights"),
    # Commodities
    ("icsg_copper", "commodities", "https://icsg.org"),
    ("eia_energy", "commodities", "https://www.eia.gov"),
    ("opec_news", "commodities", "https://www.opec.org"),
    ("northern_miner", "commodities", "https://www.northernminer.com"),
    # Policy, budgets, tax; think tanks read in pairs
    ("bc_gov_finance", "policy", "https://news.gov.bc.ca/ministries/finance"),
    ("finance_canada", "policy", "https://www.canada.ca/en/department-finance/news.html"),
    ("pbo_publications", "policy", "https://www.pbo-dpb.ca/en/publications"),
    ("fraser_institute", "policy", "https://www.fraserinstitute.org"),
    ("ccpa", "policy", "https://policyalternatives.ca"),
    ("cd_howe", "policy", "https://www.cdhowe.org"),
    # AI in finance
    ("cpa_ontario_insights", "ai", "https://www.cpaontario.ca/insights/blog"),
    ("cfo_dive", "ai", "https://www.cfodive.com"),
    ("journal_of_accountancy", "ai", "https://www.journalofaccountancy.com"),
    # ERP vendors
    ("acumatica_newsroom", "erp", "https://www.acumatica.com/corporate-newsroom/"),
    ("epicor_news", "erp", "https://www.epicor.com/en/company/news/"),
    ("xero_blog", "erp", "https://blog.xero.com"),
]

# Google News searches the source list replaces with a primary source.
# Paused (not deleted) only when run with --pause-google.
GOOGLE_REPLACED = [
    "selkirk_copper_news", "statcan_daily", "bc_gov_news",
    "cpa_canada_bc", "big4_canada_tax", "accounting_today_tech",
]

# Built-ins that fit the previous owner's interests. Switched off, not
# deleted, so they can be re-enabled from Settings -> Feeds.
DISABLE = ["nvd_recent", "cisa_kev", "github_releases"]


def call(method, path, body=None, timeout=90):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        API + path, data=data, method=method,
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read()
            return resp.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as exc:
        try:
            detail = json.loads(exc.read()).get("detail")
        except Exception:
            detail = exc.reason
        return exc.code, {"detail": detail}


def main():
    try:
        status, sources = call("GET", "/sources")
    except urllib.error.URLError as exc:
        sys.exit(f"Can't reach Popping at {API} ({exc.reason}). Is it running? Try: docker compose ps")
    if status != 200:
        sys.exit(f"GET /sources failed: {status} {sources}")
    by_name = {s["name"]: s for s in sources}

    skip_reddit = "--skip-reddit" in sys.argv[1:]
    added, skipped, failed = [], [], []
    for name, type_, category, url, refresh, headers in FEEDS:
        if skip_reddit and type_ == "reddit":
            continue
        if name in by_name:
            skipped.append(name)
            print(f"  = {name}: already there")
            continue
        print(f"  ? {name}: testing...", flush=True)
        body = {"type": type_, "category": category, "url": url, "custom_headers": headers}
        status, result = call("POST", "/sources/test", body)
        if status != 200 or not result.get("ok"):
            reason = (result or {}).get("error_kind") or (result or {}).get("detail") or status
            failed.append((name, reason))
            print(f"  x {name}: failed test ({reason}), not added")
            continue
        body.update(name=name, refresh_interval_seconds=refresh)
        status, result = call("POST", "/sources", body)
        if status == 200:
            added.append(name)
            print(f"  + {name}: added")
        else:
            failed.append((name, (result or {}).get("detail") or status))
            print(f"  x {name}: add failed ({(result or {}).get('detail') or status})")

    for name, category, url in AUTO_FEEDS:
        if name in by_name:
            skipped.append(name)
            print(f"  = {name}: already there")
            continue
        print(f"  ? {name}: looking for a feed...", flush=True)
        status, result = call("POST", "/sources/auto", {"url": url, "category": category}, timeout=120)
        if status != 200 or not (result or {}).get("found"):
            reason = (result or {}).get("detail") or ("no feed or sitemap found" if status == 200 else status)
            failed.append((name, reason))
            print(f"  x {name}: {reason}, not added")
            continue
        row = result["source"]
        if row["name"] != name:
            call("PATCH", f"/sources/{row['id']}", {"name": name})
        added.append(name)
        print(f"  + {name}: added ({result.get('kind')})")
        # Each add kicks off an LLM "more like this" lookup; spacing
        # them out keeps Groq's free tier under its per-minute limit.
        time.sleep(3)

    pause = list(DISABLE)
    if "--pause-google" in sys.argv[1:]:
        pause += GOOGLE_REPLACED
    # Re-read so feeds added above can be paused in the same run.
    _, sources = call("GET", "/sources")
    by_name = {s["name"]: s for s in sources}
    for name in pause:
        row = by_name.get(name)
        if row and row.get("active"):
            status, _ = call("PATCH", f"/sources/{row['id']}", {"active": False})
            print(f"  - {name}: switched off" if status == 200 else f"  x {name}: couldn't switch off ({status})")

    print()
    print(f"Added {len(added)}, already there {len(skipped)}, failed {len(failed)}.")
    for name, reason in failed:
        print(f"  failed: {name} ({reason})")


if __name__ == "__main__":
    main()

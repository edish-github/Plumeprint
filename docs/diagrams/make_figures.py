# Regenerates figures 16-18. Figures 17-18 need the feasibility data files (see paths inside).
import json, time, urllib.request, numpy as np, pandas as pd
import matplotlib; matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import Circle, Wedge, FancyArrowPatch, PathPatch
from matplotlib.path import Path
PAPER="#F6F3EC"; INK="#1B1B1F"; TEAL="#1B7F6B"; RED="#D9381E"; SLATE="#64748B"; AMBER="#B7791F"; SAND="#8A7A4F"
plt.rcParams.update({"font.family":"Liberation Sans","font.size":11,"axes.edgecolor":INK,"axes.labelcolor":INK,"xtick.color":INK,"ytick.color":INK})

# ---------- 16: upwind geometry ----------
def xy(b,d): return d*np.sin(np.radians(b)), d*np.cos(np.radians(b))
fig,ax=plt.subplots(figsize=(11,8.2),dpi=170); fig.patch.set_facecolor("white"); ax.set_facecolor("white")
theta,sigma,R=145,25,4.3
ax.add_patch(Wedge((0,0),R,90-(theta+sigma),90-(theta-sigma),color="#FCE8D5",ec="#C2571A",lw=1,alpha=.85,zorder=1))
x,y=xy(theta,R); ax.plot([0,x],[0,y],color="#C2571A",lw=1.6,ls="--",zorder=2)
ax.annotate("",xy=xy(theta,0.55),xytext=xy(theta,2.1),arrowprops=dict(arrowstyle="-|>",color="#C2571A",lw=2.4),zorder=6)
ax.text(2.95,-3.75,"wind blows FROM θ = 145°\n(arrow shows the air moving toward the monitor)",color="#8A3A0C",fontsize=10.5,ha="left",va="center",weight="bold")
ax.text(-0.9,-4.75,"upwind cone θ ± σ,  σ = 25° (modelled wind)",color="#8A3A0C",fontsize=10.5,ha="center")
fac=[("Facility A",133,3.0,0.70,TEAL),("Facility B\n(large, close)",200,1.55,0.80,AMBER),("Facility C",300,3.6,0.45,SLATE)]
for name,b,d,r,c in fac:
    cx,cy=xy(b,d); ax.add_patch(Circle((cx,cy),r,fc=c,ec=INK,alpha=.30,lw=1.2,zorder=3)); ax.plot(cx,cy,"o",color=c,ms=5,zorder=4)
    a=np.degrees(np.arcsin(min(1,r/d)))
    for bb in (b-a,b+a):
        tx,ty=xy(bb,np.sqrt(max(d*d-r*r,0.01))); ax.plot([0,tx],[0,ty],color=c,lw=1,alpha=.9,zorder=2)
    delta=max(0,abs(theta-b)-a); s=np.exp(-.5*(delta/sigma)**2)
    off={"Facility A":(3.15,1.05),"Facility B\n(large, close)":(-3.0,-0.75),"Facility C":(-1.0,1.35)}[name]
    ax.text(cx+off[0],cy+off[1],f"{name}\nβ = {b}°, d = {d} km, r = {r} km\nα = asin(r/d) = {a:.0f}°\nΔ = max(0, |θ−β| − α) = {delta:.0f}°\nhour score = {s:.2f}",fontsize=9.5,color=INK,ha="center",va="center",
            bbox=dict(boxstyle="round,pad=0.35",fc="white",ec=c,lw=1.2),zorder=7)
ax.plot(0,0,"s",color=INK,ms=11,zorder=8); ax.text(0.18,0.28,"monitor",weight="bold",fontsize=11,color=INK,zorder=8)
ax.annotate("N",xy=(6.3,4.3),xytext=(6.3,3.3),ha="center",fontsize=12,weight="bold",arrowprops=dict(arrowstyle="-|>",color=INK,lw=1.6))
ax.text(-6.0,-5.35,"hour score  s = exp(−½ (Δ/σ)²)          S_bearing = ppb-weighted mean of s over the episode's hours\n"
        "σ = 15° on-site measured wind · 25° modelled wind · 45° when wind < 1.5 m/s · hours below 0.5 m/s are ignored (calm)\n"
        "A facility's footprint widens its angular span α, so a big plant next to the monitor is judged fairly.",fontsize=9.6,color=INK,va="top")
ax.set_xlim(-6.4,7.4); ax.set_ylim(-6.9,4.9); ax.set_aspect("equal"); ax.axis("off")
ax.set_title("Bearing test geometry: is this facility upwind of the monitor during this hour?",fontsize=13.5,weight="bold",color=INK,loc="left")
fig.savefig("16-upwind-geometry.png",bbox_inches="tight",facecolor="white"); plt.close(fig)


# ---------- 17: two ledgers, real feasibility data ----------
m=pd.read_csv("/home/claude/tc_merged.csv",parse_dates=["t","tl"]).sort_values("t")
E=pd.read_csv("/home/claude/galveston_events_2023.csv",parse_dates=["start_utc","end_utc"]); E=E[E.so2_lb>0].copy()
hi=m[m.v>=5].copy(); hi["g"]=(hi.t.diff()>pd.Timedelta(hours=4)).cumsum()
ep=hi.groupby("g").agg(start=("t","min"),end=("t","max"),peak=("v","max"),tpk=("t",lambda s: s.iloc[int(np.argmax(hi.loc[s.index,"v"].values))])).reset_index(drop=True)
ep["end"]+=pd.Timedelta(hours=1); links=[]; ep["verdict"]="UNEXPLAINED"
for i,r in ep.iterrows():
    ov=E[(E.start_utc<=r.end+pd.Timedelta(hours=2))&(E.end_utc>=r.start-pd.Timedelta(hours=2))]
    if len(ov):
        best=ov.assign(dur=(ov.end_utc-ov.start_utc)).sort_values("dur").iloc[0]
        ep.loc[i,"verdict"]="WEAK" if best.dur>pd.Timedelta(days=7) else "MATCHED"; links.append((best.id,i))
E["peak_during"]=[m[(m.t>=a-pd.Timedelta(hours=1))&(m.t<=b+pd.Timedelta(hours=1))].v.max() for a,b in zip(E.start_utc,E.end_utc)]
matched_ids={k for k,i in links if ep.loc[i,"verdict"]=="MATCHED"}
def status(r):
    if r.id in matched_ids: return "SEEN"
    if pd.isna(r.peak_during): return "NO DATA"
    return "FAINT" if r.peak_during>=1.1 else "UNSEEN"
E["status"]=E.apply(status,axis=1)
lane={"BLANCHARD":2,"VALERO":1}; E["lane"]=[lane.get(n.split()[0],0) for n in E["name"]]
col={"SEEN":TEAL,"FAINT":AMBER,"UNSEEN":SLATE,"NO DATA":"#C8CCD4"}
fig,(a1,a2)=plt.subplots(2,1,figsize=(15,7.6),dpi=160,sharex=True,gridspec_kw={"height_ratios":[1,1.25],"hspace":0.04}); fig.patch.set_facecolor(PAPER)
for a in (a1,a2): a.set_facecolor(PAPER); [a.spines[s].set_visible(False) for s in ("top","right")]
for _,r in E.iterrows():
    w=max((r.end_utc-r.start_utc)/pd.Timedelta(days=1),1.6); h=0.18+0.15*np.log10(1+r.so2_lb)
    a1.barh(r.lane,w,left=r.start_utc,height=h,color=col[r.status],alpha=.9,edgecolor=INK,linewidth=.4)
a1.set_yticks([0,1,2]); a1.set_yticklabels(["Other facilities","Valero refinery","Marathon refinery\n(Blanchard)"],fontsize=10); a1.set_ylim(-.6,2.75)
fig.suptitle("Two ledgers · Texas City 2023 · prototype drawn from the feasibility data (time + pollutant matching only)",x=0.125,ha="left",weight="bold",fontsize=13.5,color=INK,y=0.965)
a1.text(0.0,1.02,"TOP — what facilities told the regulator: self-reported events listing SO2 (bar height ~ log of pounds)",transform=a1.transAxes,fontsize=10,color=INK,va="bottom")
mm_=m.set_index("t").v.reindex(pd.date_range(m.t.min(),m.t.max(),freq="h")); a2.fill_between(mm_.index,0,np.sqrt(mm_.clip(lower=0)),color=INK,alpha=.75,lw=0); a2.set_ylabel("SO2 at the monitor (ppb, sqrt scale)")
tk=[0,1,5,15,30,45]; a2.set_yticks(np.sqrt(tk)); a2.set_yticklabels(tk); a2.set_ylim(0,np.sqrt(50))
vc={"MATCHED":TEAL,"WEAK":AMBER,"UNEXPLAINED":RED}
for i,r in ep.iterrows():
    a2.plot(r.tpk,np.sqrt(r.peak),"o",ms=9,color=vc[r.verdict],mec=INK,mew=.6,zorder=5)
a2.text(0.0,-0.2,"BOTTOM — what the air recorded: hourly SO2 at EPA monitor 48-167-0005; dots mark episodes of 5 ppb or more",transform=a2.transAxes,fontsize=10,color=INK)
import matplotlib.dates as mdates
for iid,i in links:
    r=ep.loc[i]; e=E[E.id==iid].iloc[0]; x0=mdates.date2num(e.start_utc); x1=mdates.date2num(r.tpk); y1=np.sqrt(r.peak)
    con=matplotlib.patches.ConnectionPatch(xyA=(x0,e.lane-0.35),coordsA=a1.transData,xyB=(x1,y1),coordsB=a2.transData,color=vc[r.verdict],lw=1.8,alpha=.9,connectionstyle="arc3,rad=0.15",zorder=10)
    fig.add_artist(con)
n_big=int((E.so2_lb>=1000).sum()); n_unseen=int(((E.so2_lb>=1000)&(E.peak_during<2)).sum()); n_ep=len(ep); n_un=int((ep.verdict=="UNEXPLAINED").sum())
a1.text(0.995,0.99,f"{n_unseen} of {n_big} reported releases ≥ 1,000 lb SO2 never lifted the monitor above 2 ppb",transform=a1.transAxes,ha="right",va="top",fontsize=11.5,weight="bold",color=SLATE)
a2.text(0.995,0.99,f"{n_un} of {n_ep} episodes have no overlapping SO2 report from any facility in the county",transform=a2.transAxes,ha="right",va="top",fontsize=11.5,weight="bold",color=RED)
from matplotlib.lines import Line2D
a1.legend(handles=[Line2D([0],[0],marker="s",ls="",mfc=col[k],mec=INK,ms=9,label=l) for k,l in [("SEEN","seen by the monitor"),("FAINT","faint bump"),("UNSEEN","unseen")]],loc="lower right",frameon=False,ncol=3,fontsize=9.5)
a2.legend(handles=[Line2D([0],[0],marker="o",ls="",mfc=vc[k],mec=INK,ms=8,label=l) for k,l in [("MATCHED","matched"),("WEAK","weak match (8-week startup window)"),("UNEXPLAINED","no matching report")]],loc="upper left",bbox_to_anchor=(0.0,0.90),frameon=False,ncol=3,fontsize=9.5)
a2.xaxis.set_major_locator(mdates.MonthLocator()); a2.xaxis.set_major_formatter(mdates.DateFormatter("%b"))
fig.savefig("17-two-ledgers-texas-city-2023.png",bbox_inches="tight",facecolor=PAPER); plt.close(fig)
print("ledger stats:",n_unseen,"of",n_big,"|",n_un,"of",n_ep,"| verdicts:",ep.verdict.value_counts().to_dict(),"| status:",E[E.so2_lb>=1000].status.value_counts().to_dict())


# ---------- 18: roses, three monitors ----------
tx=pd.read_csv("/home/claude/tx_so2_2023.csv",dtype=str); tx["v"]=pd.to_numeric(tx["Sample Measurement"],errors="coerce")
def merged(cc,sn):
    s=tx[(tx["County Code"]==cc)&(tx["Site Num"]==sn)].copy(); lat,lon=float(s["Latitude"].iloc[0]),float(s["Longitude"].iloc[0])
    url=f"https://archive-api.open-meteo.com/v1/archive?latitude={lat}&longitude={lon}&start_date=2023-01-01&end_date=2023-12-31&hourly=wind_speed_10m,wind_direction_10m&timezone=GMT&wind_speed_unit=ms"
    for k in range(4):
        try: w=json.load(urllib.request.urlopen(url,timeout=90))["hourly"]; break
        except Exception as ex: print("retry",k,ex); time.sleep(4)
    W=pd.DataFrame({"t":pd.to_datetime(w["time"]),"ws":w["wind_speed_10m"],"wd":w["wind_direction_10m"]})
    s["t"]=pd.to_datetime(s["Date GMT"]+" "+s["Time GMT"]); return s.merge(W,on="t").dropna(subset=["v","wd"])
panels=[("Texas City · 48-167-0005",m.rename(columns={})),]
for cc,sn,lab in [("245","0011","Port Arthur area · 48-245-0011"),("227","1072","Big Spring · 48-227-1072")]:
    try: panels.append((lab,merged(cc,sn)))
    except Exception as ex: print("skip",lab,ex)
fig,axs=plt.subplots(1,len(panels),figsize=(5.4*len(panels),5.9),dpi=160,subplot_kw={"projection":"polar"}); fig.patch.set_facecolor(PAPER); axs=np.atleast_1d(axs)
for ax,(lab,d) in zip(axs,panels):
    d=d[d.ws>=1.0]; thr=d.v.quantile(.95); b=(np.floor(d.wd/10)*10).astype(int)%360
    g=d.assign(b=b).groupby("b").agg(h=("v","size"),hi=("v",lambda x:(x>thr).sum())); g["cpf"]=g.hi/g.h; g=g.reindex(range(0,360,10)).fillna(0)
    ax.set_theta_zero_location("N"); ax.set_theta_direction(-1); ax.set_facecolor(PAPER)
    ax.bar(np.radians(g.index+5),g.cpf*100,width=np.radians(9.2),color=[RED if v>=0.5*g.cpf.max() else "#C9C3B4" for v in g.cpf],edgecolor=INK,linewidth=.4)
    ax.set_xticks(np.radians([0,45,90,135,180,225,270,315])); ax.set_xticklabels(["N","NE","E","SE","S","SW","W","NW"],fontsize=10)
    ax.set_rlabel_position(22); ax.tick_params(axis="y",labelsize=8); ax.grid(color=SAND,alpha=.35)
    pk=int(g.cpf.idxmax()); ax.set_title(f"{lab}\npeak bin {pk}–{pk+10}° · {g.cpf.max()*100:.0f}% of those hours are top-5% SO2\n(top-5% threshold {thr:.1f} ppb · n = {len(d):,} h)",fontsize=10.5,color=INK,pad=14)
fig.suptitle("Directional fingerprints, 2023: share of hours in each wind-direction bin that fall in the monitor's top 5% for SO2 (wind blowing FROM)",fontsize=12.5,weight="bold",color=INK,y=1.02)
fig.savefig("18-roses-three-sites-2023.png",bbox_inches="tight",facecolor=PAPER); plt.close(fig)


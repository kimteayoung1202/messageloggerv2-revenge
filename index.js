(function(){'use strict';const modules={"./core":function(module,exports,require){
'use strict';
const clone=value=>JSON.parse(JSON.stringify(value));
const id=value=>typeof value==='string'?value:'';
function snapshot(raw, channelId='') {
  if(!raw||typeof raw!=='object'||!id(raw.id)||!id(raw.channel_id||raw.channelId||channelId)) return null;
  const m={id:raw.id,channel_id:raw.channel_id||raw.channelId||channelId};
  // Partial update payloads must keep omitted fields omitted.
  const keys=['guild_id','content','timestamp','edited_timestamp','type','flags','tts','pinned','state','nonce','optimistic',
    'mention_everyone','mentions','mention_roles','attachments','embeds','sticker_items',
    'message_reference','referenced_message','components','poll','author'];
  for(const key of keys) if(key in raw) {
    try {m[key]=clone(raw[key]);} catch (_) {}
  }
  if(!m.guild_id&&raw.guildId) m.guild_id=raw.guildId;
  return m;
}
function cleanEmbed(input){
  if(!input?.id)return clone(input);
  const out={};for(const [key,source]of Object.entries({title:'rawTitle',description:'rawDescription',reference_id:'referenceId',type:'type',url:'url'}))if(input[source]!==undefined)out[key]=input[source];
  if(typeof input.color==='string'){let value=input.color.slice(1);if(value.length===3)value=[...value].map(x=>x+x).join('');out.color=parseInt(value,16);}
  for(const key of ['provider','footer','author'])if(input[key]){out[key]={};for(const field of ['name','url','text'])if(input[key][field]!==undefined)out[key][field]=input[key][field];
    for(const [source,target]of [['iconURL','icon_url'],['iconProxyURL','proxy_icon_url']])if(input[key][source]!==undefined)out[key][target]=input[key][source];}
  for(const key of ['thumbnail','image','video'])if(input[key]){const value=input[key];if(key==='thumbnail'&&!value.proxyURL&&value.url?.endsWith('?format=jpeg'))continue;
    out[key]={url:value.url,proxy_url:key==='thumbnail'?value.proxyURL?.split('?format')[0]:value.proxyURL,width:value.width,height:value.height};}
  if(input.timestamp?._isAMomentObject&&typeof input.timestamp.milliseconds==='function')out.timestamp=input.timestamp.milliseconds();
  if(input.fields?.length)out.fields=input.fields.map(f=>({name:f.rawName,value:f.rawValue,inline:f.inline}));return out;
}
function importData(input,userId){
  const data=input.data||input;
  if(data.accountId&&data.accountId!==userId)throw Error('Archive account mismatch');
  if(Array.isArray(data.records))return {...data,accountId:userId};
  if(!data.messageRecord||typeof data.messageRecord!=='object')throw Error('지원하지 않는 백업 형식');
  const indexed=(map,id,channel)=>Array.isArray(map?.[channel])&&map[channel].includes(id);
  const records=[];
  for(const[id,r]of Object.entries(data.messageRecord)){
    const message=snapshot(r.message);if(!message?.author?.id)continue;
    const history=(r.edit_history||r.editHistory||[]).map(v=>({at:v.time??v.editedAt,message:{...clone(message),content:v.content}}));
    const deletedAt=r.delete_data?.time||r.deletedata?.deletetime||0;
    const kinds={deleted:indexed(data.deletedMessageRecord,id,message.channel_id),edited:indexed(data.editedMessageRecord,id,message.channel_id)||history.length>0,purged:indexed(data.purgedMessageRecord,id,message.channel_id)};
    records.push({message,history,deletedAt,kinds,bulk:kinds.purged,ghostPing:!!r.ghost_pinged,localMentioned:!!r.local_mentioned,hidden:!!r.delete_data?.hidden,editsHidden:!!r.edits_hidden});
  }
  return {schema:3,accountId:userId,records};
}
module.exports={snapshot,clone,cleanEmbed,importData};


},
"./engine":function(module,exports,require){
'use strict';
// Behavioral compatibility engine, independently authored. No upstream source is embedded.
const {snapshot,clone,cleanEmbed}=require('./core');
const BASE=Object.freeze({ignoreMutedGuilds:true,ignoreMutedChannels:true,ignoreBots:true,
  ignoreSelf:false,ignoreBlockedUsers:true,ignoreNSFW:false,ignoreLocalEdits:false,ignoreLocalDeletes:false,
  alwaysLogGhostPings:false,onlyLogWhitelist:true,whitelist:[],blacklist:[],notificationBlacklist:[],
  alwaysLogSelected:true,alwaysLogDM:true,messageCacheCap:1000,savedMessagesCap:10000,
  showDeletedMessages:true,showPurgedMessages:true,showEditedMessages:true,restoreDeletedMessages:true,
  showDeletedCount:true,showEditedCount:true,reverseOrder:true,maxShownEdits:5,hideNewerEditsFirst:true,
  displayDates:true,useAlternativeDeletedStyle:false,deletedMessageColor:'#ed4245',editedMessageColor:'#949ba4',
  useNotificationsInstead:true,blockSpamEdit:false,cacheAllImages:true,dontDeleteCachedImages:false,
  aggresiveMessageCaching:true,dontSaveData:false,autoBackup:false,renderCap:50,showOpenLogsButton:true,
  contextmenuSubmenuName:'Message Logger',toastToggles:{sent:false,edited:true,deleted:true,ghostPings:true},
  toastTogglesDMs:{sent:false,edited:true,deleted:true,ghostPings:true},
  // Platform extensions: optional files beyond images, bounded async native IO, streamer visibility.
  cacheOtherFiles:false,maxFileBytes:8*1048576,maxMediaBytes:64*1048576,inlineEnabled:true,
  streamMode:false,oldestActivityFirst:false});
function settings(value={}) {
  const s={...clone(BASE),...value};
  for(const key of ['whitelist','blacklist','notificationBlacklist'])s[key]=Array.isArray(s[key])?s[key].filter(x=>typeof x==='string'):[];
  for(const key of ['toastToggles','toastTogglesDMs'])s[key]={...BASE[key],...value[key]};
  for(const key of ['messageCacheCap','savedMessagesCap','maxShownEdits','renderCap','maxFileBytes','maxMediaBytes']){
    const min=['messageCacheCap','savedMessagesCap','maxShownEdits'].includes(key)?0:1;
    s[key]=Math.max(min,Math.trunc(Number(s[key])||0));
  }
  return s;
}
const messageTime=m=>Date.parse(m.timestamp)||Number(m.timestamp)||0;
const recordTime=r=>r.deletedAt||r.history[r.history.length-1]?.at||messageTime(r.message);
const normal=m=>!!m&&[0,19,20].includes(m.type)&&!((m.type===20)&&((m.flags||0)&64));
const hasBody=m=>!!(m.content||(m.attachments||[]).length||(m.embeds||[]).length);
class Engine {
  constructor(data={},userId='',context={}) {
    if(data.accountId&&data.accountId!==userId)throw Error('Archive account mismatch');
    this.userId=userId;this.context=context;this.options=settings(data.options);
    this.records=new Map();this.cache=new Map();this.temporary=new Map();this.localDeletes=[];
    this.selected=context.selectedChannelId||'';this.counts={deleted:{},edited:{}};this.spam=new Map();
    this.modifiers=new Map();this.noTint=new Set();this.effects=[];
    for(const raw of data.records||[]) {
      const message=snapshot(raw.message);if(!message?.author?.id)continue;
      const history=(raw.history||[]).filter(h=>h?.message&&typeof h.message.content==='string');
      const kinds=raw.kinds||{edited:!!history.length,deleted:!!raw.deletedAt&&!raw.bulk,purged:!!raw.deletedAt&&!!raw.bulk};
      if(kinds.edited||kinds.deleted||kinds.purged)this.records.set(message.id,{...raw,message,history,kinds,localMentioned:raw.localMentioned??this.mentioned(message)});
    }
  }
  now(){return this.context.now?.()??Date.now();}
  channel(channelId){return this.context.getChannel?.(channelId)||null;}
  mentioned(m){
    if(this.context.isMentioned)return this.context.isMentioned(m,this.userId);
    if(m.mention_everyone||m.mentionEveryone)return true;
    if((m.mentions||[]).some(u=>(u.id||u)===this.userId))return true;
    const roles=this.context.getMember?.(m.guild_id,this.userId)?.roles||[];
    return (m.mention_roles||m.mentionRoles||[]).some(role=>roles.includes(role));
  }
  cached(messageId,channelId){return this.cache.get(messageId)||this.context.getMessage?.(channelId,messageId)||null;}
  lookup(messageId){return this.records.get(messageId)?.message||this.cache.get(messageId)||null;}
  effect(type,detail={}){this.effects.push({type,...detail});}
  policy(channel) {
    const o=this.options,guild=channel.guild_id;
    if((o.alwaysLogSelected&&this.selected===channel.id)||(o.alwaysLogDM&&!guild))return true;
    const cw=o.whitelist.includes(channel.id),gw=guild&&o.whitelist.includes(guild);
    const cb=o.blacklist.includes(channel.id),gb=guild&&o.blacklist.includes(guild);
    const ignored=!!guild&&((o.ignoreNSFW&&channel.nsfw&&!cw)||
      (o.ignoreMutedChannels&&(this.context.isChannelMuted?.(guild,channel.id)||
        (channel.parent_id&&this.context.isChannelMuted?.(guild,channel.parent_id)))));
    if(gb)return cw;
    if(gw)return !cb&&(!ignored||cw);
    if(o.onlyLogWhitelist)return cw;
    return !cb&&(!(ignored||(o.ignoreMutedGuilds&&guild&&this.context.isGuildMuted?.(guild)))||cw);
  }
  authorAllowed(author,e) {
    const o=this.options,local=author?.id===this.userId;
    if(author?.avatar==='clyde'||(author?.bot&&o.ignoreBots)||(local&&o.ignoreSelf))return false;
    if(author&&o.ignoreBlockedUsers&&!local&&this.context.isBlocked?.(author.id))return false;
    if(local&&e.type==='MESSAGE_UPDATE'&&o.ignoreLocalEdits)return false;
    if(local&&e.type==='MESSAGE_DELETE'&&o.ignoreLocalDeletes&&this.localDeletes.includes(e.id))return false;
    return true;
  }
  markLocalDelete(messageId){this.localDeletes.push(messageId);if(this.localDeletes.length>10)this.localDeletes.shift();}
  makeRecord(m){const message=snapshot(m);message.embeds=(m.embeds||[]).map(cleanEmbed);return {message,history:[],localMentioned:this.mentioned(message),
    ghostPing:false,deletedAt:0,hidden:false,editsHidden:false,kinds:{deleted:false,edited:false,purged:false},seenAt:this.now()};}
  canShowDeleted(r){return !!r&&!r.hidden&&!this.options.streamMode&&
    ((r.kinds.deleted&&this.options.showDeletedMessages)||(r.kinds.purged&&this.options.showPurgedMessages));}
  notify(kind,channel,m,detail={}) {
    const o=this.options;if(o.streamMode)return;
    const toggles=channel.guild_id?o.toastToggles:o.toastTogglesDMs;
    if(!toggles[kind])return;
    if(kind==='ghostPings') {
      if(this.selected===channel.id)return;
    } else {
      if(o.notificationBlacklist.includes(channel.id)||o.notificationBlacklist.includes(channel.guild_id))return;
      const local=m?.author?.id===this.userId;
      if(['edited','deleted'].includes(kind)&&m){
        if(channel.guild_id?local&&toggles.disableToastsForLocal:local)return;
      }
      if(kind==='sent'&&this.selected===channel.id)return;
    }
    this.effect('notification',{kind,channelId:channel.id,messageId:m?.id,mode:kind==='ghostPings'?'notification':o.useNotificationsInstead?'notification':'toast',...detail});
    if(kind==='ghostPings'&&!o.useNotificationsInstead)this.effect('notification',{kind,channelId:channel.id,messageId:m?.id,mode:'toast',...detail});
  }
  count(kind,channel,n=1){if(!this.counts[kind][channel.id])this.counts[kind][channel.id]=0;if(this.selected!==channel.id)this.counts[kind][channel.id]+=n;}
  prefetch(channel){if(this.options.aggresiveMessageCaching&&!this.context.channelReady?.(channel.id))this.effect('prefetch',{channelId:channel.id,limit:50});}
  cacheCreate(m,e,ghostOnly=false) {
    if(!normal(m)||!hasBody(m)||m.state==='SENDING'||e.optimistic||(ghostOnly&&!this.mentioned(m)))return false;
    if(this.cache.has(m.id))return false;
    const clean=snapshot(m);if(!clean?.author?.id)return false;
    this.cache.set(m.id,clean);return true;
  }
  savedDelete(m,kind) {
    let r=this.records.get(m.id);if(!r)r=this.makeRecord(m);
    r.deletedAt=this.now();r.kinds[kind]=true;r.bulk=kind==='purged';r.ghostPing=this.mentioned(m);
    for(const a of r.message.attachments||[])if(a.proxy_url)a.url=a.proxy_url;
    this.records.set(m.id,r);this.effect('changed');
    if(this.options.cacheAllImages)this.effect('cacheMedia',{message:clone(r.message)});
    return r;
  }
  update(e,channel,ghostOnly) {
    const m=e.message;
    if(!m.edited_timestamp) {
      if(m.embeds&&this.cache.has(m.id))this.cache.get(m.id).embeds=m.embeds.map(cleanEmbed);
      return;
    }
    if(!ghostOnly){if(this.options.showEditedCount)this.count('edited',channel);this.prefetch(channel);}
    const saved=this.records.get(m.id),edited=saved?.kinds.edited?saved:null;
    const cached=this.cached(m.id,channel.id);
    let r=edited||(ghostOnly?this.temporary.get(m.id):null);
    if(!r&&!cached)return;
    if(r&&!r.message.edited_timestamp)r.message.edited_timestamp=m.edited_timestamp;
    if(ghostOnly&&edited&&!edited.localMentioned){edited.message.content=m.content;return;}
    const last=r?.message||cached;
    if(typeof m.content!=='string'||last.content===m.content)return;
    if(!r)r=this.makeRecord(last);
    const ghost=!r.ghostPing&&r.localMentioned&&!this.mentioned({...r.message,...m});
    r.history.push({at:this.now(),message:{...clone(r.message),content:r.message.content}});
    r.message.content=m.content;r.seenAt=this.now();
    if(ghostOnly&&!edited){this.temporary.set(m.id,r);if(!ghost)return;}
    r.kinds.edited=true;if(ghost)r.ghostPing=true;
    this.records.set(m.id,r);this.effect('changed');
    if(!ghostOnly){
      const toggles=channel.guild_id?this.options.toastToggles:this.options.toastTogglesDMs;
      const local=r.message.author?.id===this.userId;
      const candidate=toggles.edited&&(channel.guild_id?(!local||!toggles.disableToastsForLocal):!local)
        &&!this.options.notificationBlacklist.includes(channel.id)&&!this.options.notificationBlacklist.includes(channel.guild_id);
      if(candidate&&this.spamAllowed(r.message.author.id))this.notify('edited',channel,r.message);
    }
    if(ghost)this.notify('ghostPings',channel,r.message);
    this.effect('refresh',{messageId:m.id,channelId:channel.id});
  }
  spamAllowed(userId) {
    // Compatibility includes the upstream setting's inverted condition: true bypasses suppression.
    if(this.options.blockSpamEdit)return true;
    const now=this.now(),s=this.spam.get(userId)||{times:[],blocked:false};s.times.push(now);if(s.times.length>10)s.times.shift();
    if(s.times.length===10&&now-s.times[0]<60000){
      if(!s.blocked)this.effect('notification',{kind:'spamBlocked',userId,mode:this.options.useNotificationsInstead?'notification':'toast'});
      s.blocked=true;
    }else if(s.blocked){s.blocked=false;s.times=[];}
    this.spam.set(userId,s);return !s.blocked;
  }
  process(event) {
    this.effects=[];let e=event,block=false;
    if(e.type==='MLV2_REPLAY')return {event:e.original,effects:[]};
    if(e.ML2&&e.type==='MESSAGE_DELETE')return {event:e,effects:[]};
    if(e.type==='MESSAGE_LOGGER_V2_SELF_TEST')return {event:null,effects:[{type:'selfTest'}]};
    if(e.type==='CHANNEL_SELECT') {
      this.selected=e.channelId||e.channel_id||'';this.modifiers.clear();this.noTint.clear();
      for(const kind of ['deleted','edited'])if(this.options[kind==='deleted'?'showDeletedCount':'showEditedCount']&&this.counts[kind][this.selected]){
        this.effect('notification',{kind:'count',countKind:kind,count:this.counts[kind][this.selected],channelId:this.selected,
          mode:this.options.useNotificationsInstead?'notification':'toast'});this.counts[kind][this.selected]=0;
      }
      return {event:e,effects:this.effects};
    }
    if(!['MESSAGE_CREATE','MESSAGE_UPDATE','MESSAGE_DELETE','MESSAGE_DELETE_BULK','LOAD_MESSAGES_SUCCESS'].includes(e.type))return {event:e,effects:[]};
    if(e.message&&!normal(e.message))return {event:e,effects:[]};
    const channelId=e.message?.channel_id||e.channelId||e.channel_id;
    const channel=this.channel(channelId);if(!channel)return {event:e,effects:[]};
    const messageId=e.message?.id||e.id;
    const candidate=e.message?.author||this.cached(messageId,channel.id)?.author;
    const author=this.context.getUser?.(candidate?.id)||candidate;
    if(!author&&!['LOAD_MESSAGES_SUCCESS','MESSAGE_DELETE_BULK'].includes(e.type))return {event:e,effects:[]};
    if(!this.authorAllowed(author,e))return {event:e,effects:[]};
    const accepted=this.policy(channel),ghostOnly=!accepted&&this.options.alwaysLogGhostPings;
    if(!accepted&&!ghostOnly)return {event:e,effects:[]};
    if(e.type==='MESSAGE_CREATE'){
      if(this.cacheCreate(e.message,e,ghostOnly)&&!ghostOnly){this.prefetch(channel);this.notify('sent',channel,e.message);}
    }else if(e.type==='MESSAGE_UPDATE'){
      this.update(e,channel,ghostOnly);
    }else if(e.type==='MESSAGE_DELETE'){
      const m=(ghostOnly?this.temporary.get(e.id)?.message:null)||this.cached(e.id,channel.id);
      if(!m||!normal(m)||(ghostOnly&&!this.mentioned(m)))return {event:e,effects:[]};
      const prior=this.records.get(e.id);
      if(!ghostOnly&&prior?.kinds.deleted)return {event:this.options.showDeletedMessages?null:e,effects:[]};
      if(!ghostOnly){if(this.options.showDeletedCount)this.count('deleted',channel);this.prefetch(channel);this.notify('deleted',channel,m);}
      if(!prior?.ghostPing&&this.mentioned(m))this.notify('ghostPings',channel,m);
      const r=this.savedDelete(m,'deleted');this.effect('refresh',{messageId:m.id,channelId:channel.id});
      block=!ghostOnly&&this.canShowDeleted(r);
    }else if(e.type==='MESSAGE_DELETE_BULK'&&!ghostOnly){
      if(this.options.showDeletedCount)this.count('deleted',channel,(e.ids||[]).length);
      for(const messageId of e.ids||[]){const m=this.cached(messageId,channel.id);
        if(m){this.savedDelete(m,'purged');this.effect('refresh',{messageId,channelId:channel.id});}}
      this.prefetch(channel);this.notify('deleted',channel,null,{bulk:true,count:(e.ids||[]).length});
      block=this.options.showPurgedMessages&&!this.options.streamMode;
    }else if(e.type==='LOAD_MESSAGES_SUCCESS'&&!ghostOnly){
      if(this.options.restoreDeletedMessages){
        const out={...e,messages:this.restore(e.messages,channel.id,{newer:!e.hasMoreAfter&&!e.isBefore,older:!e.hasMoreBefore&&!e.isAfter})};
        if(out.jump?.ML2)delete out.jump;e=out;
      }
    }
    return {event:block?null:e,effects:this.effects};
  }
  restore(messages,channelId,boundaries={}) {
    if(!Array.isArray(messages)||!messages.length||this.options.streamMode)return messages;
    // Preserve upstream's timestamp-based snowflake ordering, including same-time ties.
    const time=id=>Number(id)/4194304+1420070400000;
    const valid=messages.filter(m=>/^\d+$/.test(m.id));if(!valid.length)return messages;
    const low=time(valid[valid.length-1].id),high=time(valid[0].id),existing=new Set(messages.map(m=>m.id));
    const candidates=[...this.records.values()].filter(r=>r.message.channel_id===channelId&&this.canShowDeleted(r)&&/^\d+$/.test(r.message.id))
      .filter(r=>(boundaries.older||time(r.message.id)>low)&&(boundaries.newer||time(r.message.id)<high));
    candidates.sort((a,b)=>time(a.message.id)-time(b.message.id));
    const sequence=[...candidates.map(r=>r.message),...messages].sort((a,b)=>time(b.id)-time(a.id));
    const out=messages.slice();for(let i=0;i<sequence.length;i++){
      const m=sequence[i];if(!existing.has(m.id)){out.splice(i,0,clone(m));existing.add(m.id);}
    }
    return out;
  }
  data(){return {schema:3,accountId:this.userId,options:clone(this.options),records:clone([...this.records.values()])};}
  clear(){this.records.clear();this.temporary.clear();}
  erase(messageId){this.records.delete(messageId);this.modifiers.delete(messageId);this.noTint.delete(messageId);}
  eraseEdit(messageId,index){const r=this.records.get(messageId);if(!r||index<0||index>=r.history.length)return false;
    r.history.splice(index,1);if(!r.history.length){r.kinds.edited=false;if(!r.deletedAt)this.records.delete(messageId);}return true;}
  visibleEdits(messageId){const r=this.records.get(messageId);if(!r||r.editsHidden||!this.options.showEditedMessages||this.options.streamMode)return [];
    const mod=this.modifiers.get(messageId)||{},all=r.history.map((h,index)=>({...h,index}));
    if(mod.editNum!=null)return all[mod.editNum]?[all[mod.editNum]]:[];
    const cap=this.options.maxShownEdits;if(!cap||mod.showAllEdits||all.length<=cap)return all;
    return this.options.hideNewerEditsFirst?all.slice(0,cap):all.slice(-cap);
  }
  maintenance(){
    while(this.cache.size>this.options.messageCacheCap)this.cache.delete(this.cache.keys().next().value);
    for(const kind of ['deleted','edited','purged']){
      const entries=[...this.records.values()].filter(r=>r.kinds[kind]).sort((a,b)=>recordTime(b)-recordTime(a));
      for(const r of entries.slice(this.options.savedMessagesCap))this.erase(r.message.id);
    }
    // Temporary ghost-only edits are session data, bounded by the same recent-cache cap.
    while(this.temporary.size>this.options.messageCacheCap)this.temporary.delete(this.temporary.keys().next().value);
    return new Set([...this.records.values()].filter(r=>r.deletedAt).flatMap(r=>(r.message.attachments||[]).map(a=>a.id)));
  }
  logs(query='',kind='all') {
    let rows=kind==='sent'?[...this.cache.values()].map(message=>({message,history:[],kinds:{},seenAt:messageTime(message)})):
      [...this.records.values()].filter(r=>kind==='all'||(kind==='ghost'||kind==='ghostpings'?r.ghostPing:r.kinds[kind]));
    for(const term of query.split(',')){
      const at=term.indexOf(':');if(at<0){if(term.trim()){const q=term.trim().toLowerCase();rows=rows.filter(r=>
        [r.message.content,r.message.author?.username,r.message.author?.id,r.message.channel_id,...r.history.map(h=>h.message.content)].join(' ').toLowerCase().includes(q));}continue;}
      const type=term.slice(0,at).trim().toLowerCase(),q=term.slice(at+1).trim().toLowerCase();
      rows=rows.filter(r=>{
        const m=r.message,channel=this.channel(m.channel_id),guildId=m.guild_id||channel?.guild_id;
        if(type==='server'||type==='guild')return guildId===q||this.context.getGuild?.(guildId)?.name?.toLowerCase().includes(q);
        if(type==='channel')return m.channel_id===q||channel?.name?.toLowerCase().includes(q.replace('#',''));
        if(type==='message'||type==='content')return m.id===q||(m.content||'').toLowerCase().includes(q);
        if(type==='user')return m.author?.id===q||(m.author?.username||'').toLowerCase().includes(q)||this.context.getMember?.(guildId,m.author?.id)?.nick?.toLowerCase().includes(q);
        if(type==='has'&&q==='image')return (m.attachments||[]).some(a=>/\.(png|jpe?g|webp|gif)$/i.test(a.filename||''))||(m.embeds||[]).some(e=>e.image);
        if(type==='has'&&q==='link')return /https?:\/\/[^\s]{2,}/.test(m.content||'');return true;
      });
    }
    if(kind==='sent'){if(!this.options.reverseOrder)rows.reverse();}
    else {rows.sort((a,b)=>recordTime(b)-recordTime(a));if(this.options.reverseOrder)rows.reverse();}
    return rows;
  }
  stats(){return {cached:this.cache.size,saved:this.records.size,
    ...Object.fromEntries(['deleted','edited','purged'].map(k=>[k,[...this.records.values()].filter(r=>r.kinds[k]).length])),
    versions:[...this.records.values()].reduce((sum,r)=>sum+r.history.length,0)};}
}
module.exports={Engine,BASE,settings,normal};


},
"./ui":function(module,exports,require){
'use strict';
const {settings,BASE,Engine}=require('./engine');
const {importData}=require('./core');
function archiveActivityTime(record){
  let newest=0;
  function include(value){
    const time=typeof value==='number'?value:typeof value==='string'?(/^\d+$/.test(value)?Number(value):Date.parse(value)):0;
    if(Number.isFinite(time)&&time>newest)newest=time;
  }
  include(record.message?.timestamp);include(record.message?.edited_timestamp);
  include(record.seenAt);include(record.deletedAt);
  for(const version of record.history||[])include(version.at);
  return newest;
}
function sortArchiveRows(rows,oldestFirst=false){
  return rows.map(record=>({record,time:archiveActivityTime(record)}))
    .sort((a,b)=>(oldestFirst?1:-1)*(a.time-b.time)).map(entry=>entry.record);
}
function createUI(api,getEngine,save,refresh,backup,getStatus){
  const React=api.react.React,RN=api.react.ReactNative,h=React.createElement;
  const text=(s,style={})=>h(RN.Text,{style:{color:'#f2f3f5',...style}},s);
  const button=(s,fn)=>h(RN.Pressable,{key:s,onPress:fn,style:{padding:10,backgroundColor:'#404249',borderRadius:6,margin:3}},text(s));
  function Options(){const [open,setOpen]=React.useState(false),[draft,setDraft]=React.useState({}),[importText,setImport]=React.useState('');
    const engine=getEngine();if(!engine)return null;
    function change(key,value){engine.options=settings({...engine.options,[key]:value});save();refresh();}
    const toggle=(label,key)=>h(RN.View,{key,style:{flexDirection:'row',alignItems:'center',paddingVertical:6}},text(label,{flex:1}),h(RN.Switch,{value:!!engine.options[key],onValueChange:v=>change(key,v)}));
    const input=(key,isArray=false)=>h(RN.View,{key},text(key,{marginTop:8}),h(RN.TextInput,{value:draft[key]??(isArray?engine.options[key].join(', '):String(engine.options[key])),
      onChangeText:v=>setDraft(d=>({...d,[key]:v})),onEndEditing:e=>{const value=e.nativeEvent.text;
        if(isArray)change(key,value.split(',').map(x=>x.trim()).filter(x=>/^\d+$/.test(x)));
        else if(typeof BASE[key]==='number'){if(/^\d+$/.test(value))change(key,Number(value));}else change(key,value);},
      style:{color:'white',backgroundColor:'#232428',padding:8,borderRadius:6}}));
    return h(RN.View,null,button(open?'MLV2 설정 접기':'MLV2 설정 펼치기',()=>setOpen(!open)),open?h(RN.View,null,
      ...Object.entries({ignoreMutedGuilds:'음소거 서버 제외',ignoreMutedChannels:'음소거 채널 제외',ignoreBots:'봇 제외',ignoreSelf:'본인 제외',ignoreBlockedUsers:'차단 사용자 제외',ignoreNSFW:'NSFW 제외',ignoreLocalEdits:'내 수정 제외',ignoreLocalDeletes:'내 직접 삭제 제외',
        onlyLogWhitelist:'화이트리스트만 기록',alwaysLogSelected:'현재 채널 우선 기록',alwaysLogDM:'DM 우선 기록',alwaysLogGhostPings:'제외 채널 고스트 핑도 기록',
        showDeletedMessages:'채팅에 삭제 표시',showPurgedMessages:'채팅에 일괄 삭제 표시',showEditedMessages:'채팅에 수정 표시',restoreDeletedMessages:'재시작 후 채팅 복원',showDeletedCount:'삭제 개수 알림',showEditedCount:'수정 개수 알림',
        hideNewerEditsFirst:'오래된 수정부터 표시',displayDates:'날짜 표시',oldestActivityFirst:'오래된 로그부터 정렬',useAlternativeDeletedStyle:'삭제 글자 대신 배경 빨강',
        dontSaveData:'디스크 저장 끄기',autoBackup:'자동 백업',aggresiveMessageCaching:'50개 캐시 요청',cacheAllImages:'삭제 이미지 로컬 저장',dontDeleteCachedImages:'참조 없는 이미지 유지',
        blockSpamEdit:'수정 알림 제한 해제',useNotificationsInstead:'알림 방식',inlineEnabled:'채팅 표시 연결',streamMode:'스트리머 표시 숨김',cacheOtherFiles:'영상·일반 파일 캐시 확장'}).map(([key,label])=>toggle(label,key)),
      ...['whitelist','blacklist','notificationBlacklist'].map(key=>input(key,true)),
      ...['messageCacheCap','savedMessagesCap','maxShownEdits','renderCap','maxFileBytes','maxMediaBytes','contextmenuSubmenuName','deletedMessageColor','editedMessageColor'].map(key=>input(key)),
      ...['toastToggles','toastTogglesDMs'].flatMap(group=>['sent','edited','deleted','ghostPings','disableToastsForLocal'].map(key=>h(RN.View,{key:group+key,style:{flexDirection:'row',paddingVertical:5}},text(group+'.'+key,{flex:1}),h(RN.Switch,{value:!!engine.options[group][key],onValueChange:v=>change(group,{...engine.options[group],[key]:v})})))),
      button('MLV2 기본값',()=>{engine.options=settings();setDraft({});save();refresh();}),
      button('모든 서버 기록 프리셋',()=>{engine.options=settings({...engine.options,onlyLogWhitelist:false,ignoreBots:false,ignoreMutedGuilds:false,ignoreMutedChannels:false});save();refresh();}),
      button('지금 백업',()=>backup().catch(console.error)),text('MLV2 / 호환 백업 JSON 가져오기'),
      h(RN.TextInput,{value:importText,onChangeText:setImport,multiline:true,style:{height:90,padding:8,color:'white',backgroundColor:'#232428'}}),
      button('가져오기',()=>{try{const d=importData(JSON.parse(importText),engine.userId);
        const imported=new Engine(d,engine.userId,engine.context);for(const[id,r]of imported.records)engine.records.set(id,r);save();refresh();setImport('');}catch(e){RN.Alert.alert('가져오기 실패',e.message);}}),
      text(JSON.stringify(getStatus()),{color:'#949ba4',fontSize:11})):null);
  }
  function Actions({record,editNum,onClose}){const engine=getEngine();if(!record||!engine)return null;
    const id=record.message.id,modifier=engine.modifiers.get(id)||{};
    function act(fn){return ()=>{fn();save();refresh(id);onClose();};}
    async function jump(){
      try{
        const navigate=api.discord.actions?.jumpToMessage;
        if(typeof navigate!=='function')throw Error('리벤지 내부 메시지 이동 기능을 찾지 못했습니다.');
        onClose();
        await navigate(record.message);
      }catch(e){RN.Alert.alert('메시지 이동 실패',String(e?.message||e));}
    }
    return h(RN.Modal,{visible:true,transparent:true,onRequestClose:onClose},h(RN.View,{style:{flex:1,justifyContent:'center',padding:24,backgroundColor:'#000a'}},
      h(RN.ScrollView,{style:{maxHeight:'80%',padding:12,backgroundColor:'#2b2d31',borderRadius:10}},text(engine.options.contextmenuSubmenuName,{fontSize:18}),
        button('메시지로 이동',jump),
        button('내용 공유',()=>RN.Share.share({message:editNum==null?record.message.content:record.history[editNum]?.message.content||''})),
        record.deletedAt?button(record.hidden?'삭제 메시지 다시 표시':'삭제 메시지 숨기기',act(()=>{record.hidden=!record.hidden;})):null,
        record.deletedAt?button(engine.noTint.has(id)?'삭제 색상 추가':'삭제 색상 제거',act(()=>engine.noTint.has(id)?engine.noTint.delete(id):engine.noTint.add(id))):null,
        record.history.length?button(record.editsHidden?'수정 이력 다시 표시':'수정 이력 숨기기',act(()=>{record.editsHidden=!record.editsHidden;})):null,
        record.history.length?button(modifier.showAllEdits?'기본 이력 개수':'모든 수정 이력 표시',act(()=>engine.modifiers.set(id,{...modifier,showAllEdits:!modifier.showAllEdits}))):null,
        editNum!=null?button('이 수정 내용으로 표시',act(()=>engine.modifiers.set(id,{...modifier,editNum}))):null,
        modifier.editNum!=null?button('원래 메시지 표시',act(()=>{const m={...modifier};delete m.editNum;engine.modifiers.set(id,m);})):null,
        modifier.editNum!=null?button('수정됨 태그 표시/숨김',act(()=>engine.modifiers.set(id,{...modifier,noSuffix:!modifier.noSuffix}))):null,
        editNum!=null?button('이 수정 이력 삭제',act(()=>engine.eraseEdit(id,editNum))):null,
        button('로그에서 제거',act(()=>engine.erase(id))),
        ...['whitelist','blacklist','notificationBlacklist'].map(key=>button(key+'에 채널 추가/제거',act(()=>{const list=engine.options[key];const channel=record.message.channel_id;engine.options[key]=list.includes(channel)?list.filter(x=>x!==channel):[...list,channel];}))),
        button('닫기',onClose))));
  }
  return {Options,Actions};
}
module.exports={createUI,sortArchiveRows};


},
"./io":function(module,exports,require){
'use strict';
// Two alternating journals: an interrupted write leaves the previous generation readable.
class Journal {
  constructor(fs,base,onError=()=>{}) {this.fs=fs;this.base=base;this.onError=onError;this.pending=null;this.running=null;this.seq=0;this.lastSlot='b';}
  async read() {
    const errors=[];
    const values=await Promise.all(['a','b'].map(async slot=>{
      const path=this.base+'-'+slot+'.json';
      try {if(this.fs.exists&&!(await this.fs.exists(path)))return null;
        const d=JSON.parse(await this.fs.readFile(path));
        if(![2,3].includes(d.schema)||!Array.isArray(d.records)||!Number.isSafeInteger(d.sequence))throw new Error('Invalid archive journal');return {data:d,slot};
      }catch(e){if(this.fs.exists)errors.push(e);return null;}
    }));
    const best=values.filter(Boolean).sort((a,b)=>b.data.sequence-a.data.sequence)[0];
    if(!best&&errors.length)throw new Error('저장 기록을 읽을 수 없어 시작을 중단했습니다. 원본 파일은 보존됩니다.');
    this.seq=best?.data.sequence||0;this.lastSlot=best?.slot||'b';return best?.data||{};
  }
  save(data) {
    // Coalesce bursts; there can be one active write and one newest pending snapshot.
    this.pending=JSON.stringify({...data,sequence:++this.seq});
    if(!this.running)this.running=this.drain().finally(()=>{this.running=null;});
    return this.running;
  }
  async drain() {
    while(this.pending) {
      const content=this.pending;this.pending=null;
      const slot=this.lastSlot==='a'?'b':'a';
      try {await this.fs.writeFile(this.base+'-'+slot+'.json',content);this.lastSlot=slot;}
      catch(e){this.onError(e);throw e;}
    }
  }
  async flush(){if(this.running)await this.running;}
}
function allowedUrl(value) {
  try {const u=new URL(value);return u.protocol==='https:'&&
    ['cdn.discordapp.com','media.discordapp.net'].includes(u.hostname)&&u.pathname.startsWith('/attachments/');}
  catch(_){return false;}
}
class MediaCache {
  constructor({fs,base,fetchData,onChange=()=>{},settings,writeBinary,deleteBinary}) {
    Object.assign(this,{fs,base,fetchData,onChange,settings,writeBinary,deleteBinary});
    this.index={};this.queue=[];this.queued=new Set();this.active=0;this.stopped=false;this.generation=0;this.controllers=new Set();
    this.indexChain=Promise.resolve();
  }
  async start(){try{const value=JSON.parse(await this.fs.readFile(this.base+'/index.json'));
    this.index=Object.fromEntries(Object.entries(value).filter(([key,v])=>/^\d+$/.test(key)&&v&&Number.isFinite(v.bytes)&&v.bytes>0));
    }catch(_){this.index={};}}
  used(){return Object.values(this.index).reduce((n,x)=>n+(x.bytes||0),0);}
  path(key){return this.base+'/'+key+'.json';}
  enqueue(attachment) {
    const o=this.settings();const key=attachment?.id;
    if(this.stopped||!o.cacheMedia||!/^\d+$/.test(key||'')||this.index[key]||this.queued.has(key)||this.queue.length>=64)return;
    const url=attachment.url||attachment.proxy_url;
    if(!allowedUrl(url)||!Number.isFinite(attachment.size)||attachment.size<=0||attachment.size>o.maxFileBytes)return;
    this.queued.add(key);this.queue.push({...attachment,url});this.pump();
  }
  pump(){while(!this.stopped&&this.active<1&&this.queue.length){const a=this.queue.shift();this.active++;
    this.download(a).catch(e=>this.onChange('첨부 저장 실패: '+String(e.message||e))).finally(()=>{
      this.active--;this.queued.delete(a.id);this.pump();});}}
  async persistIndex(){const s=JSON.stringify(this.index);this.indexChain=this.indexChain.catch(()=>{}).then(()=>this.fs.writeFile(this.base+'/index.json',s));await this.indexChain;}
  async download(a){
    const o=this.settings(),generation=this.generation;
    if(this.used()+a.size>o.maxMediaBytes){this.onChange('첨부 캐시 용량 한도 도달');return;}
    const controller=new AbortController();this.controllers.add(controller);
    const timeout=setTimeout(()=>controller.abort(),15000);
    try {
      let result;
      for(let attempt=0;attempt<4;attempt++){
        try{result=await this.fetchData(a.url,o.maxFileBytes,controller.signal);break;}
        catch(e){if(controller.signal.aborted||[403,404].includes(e.status)||e.permanent||attempt===3)throw e;
          await new Promise((resolve,reject)=>{const done=()=>{clearTimeout(wait);controller.signal.removeEventListener('abort',cancel);resolve();};
            const cancel=()=>{clearTimeout(wait);reject(new Error('다운로드 취소'));};const wait=setTimeout(done,1000);
            controller.signal.addEventListener('abort',cancel,{once:true});});}
      }
      if(this.stopped||generation!==this.generation)return;
      if(result.bytes>o.maxFileBytes||this.used()+result.bytes>o.maxMediaBytes)throw new Error('첨부 용량 한도 초과');
      if(!/^data:[^;]*;base64,/.test(result.uri))throw new Error('지원하지 않는 첨부 인코딩');
      await this.fs.writeFile(this.path(a.id),JSON.stringify({uri:result.uri}));
      if(this.stopped||generation!==this.generation){await this.fs.rm(this.path(a.id));return;}
      this.index[a.id]={bytes:result.bytes,name:a.filename||a.id,type:a.content_type||result.type,at:Date.now()};
      if(this.writeBinary)try{this.index[a.id].localUri=await this.writeBinary(a.id,a.filename||a.id,result.uri.slice(result.uri.indexOf(',')+1));}
        catch(e){this.onChange('네이티브 파일 저장 실패. Base64 캐시는 보존됨: '+String(e.message||e));}
      if(this.stopped||generation!==this.generation){delete this.index[a.id];await this.fs.rm(this.path(a.id));if(this.deleteBinary)await this.deleteBinary(a.id,a.filename||a.id);return;}
      await this.persistIndex();this.onChange();
    } finally {clearTimeout(timeout);this.controllers.delete(controller);}
  }
  async get(key){if(!/^\d+$/.test(key)||!this.index[key])return null;
    try{return JSON.parse(await this.fs.readFile(this.path(key))).uri;}catch(_){return null;}}
  async clear(){this.generation++;this.queue=[];this.queued.clear();for(const c of this.controllers)c.abort();
    const previous=this.index,keys=Object.keys(previous);this.index={};await this.persistIndex();
    await Promise.all(keys.map(async key=>{await this.fs.rm(this.path(key)).catch(()=>{});if(this.deleteBinary)await this.deleteBinary(key,previous[key].name).catch(()=>{});}));this.onChange();}
  stop(){this.stopped=true;this.queue=[];for(const c of this.controllers)c.abort();}
  async prune(keep){const keys=Object.keys(this.index).filter(key=>!keep.has(key));for(const key of keys){const entry=this.index[key];delete this.index[key];await this.fs.rm(this.path(key)).catch(()=>{});if(this.deleteBinary)await this.deleteBinary(key,entry.name).catch(()=>{});}if(keys.length)await this.persistIndex();}
}
async function fetchData(url,limit,signal) {
  const response=await fetch(url,{signal,credentials:'omit',redirect:'error'});
  if(!response.ok){const e=new Error('HTTP '+response.status);e.status=response.status;throw e;}
  const declared=Number(response.headers.get('content-length'));
  if(!Number.isFinite(declared)||declared<=0||declared>limit){const e=new Error('첨부 크기를 확인할 수 없거나 용량 한도 초과');e.permanent=true;throw e;}
  const blob=await response.blob();if(blob.size>limit)throw new Error('첨부파일이 너무 큼');
  const uri=await new Promise((resolve,reject)=>{
    const reader=new FileReader();const cancel=()=>{reader.abort();reject(new Error('다운로드 취소'));};
    signal.addEventListener('abort',cancel,{once:true});
    reader.onload=()=>{signal.removeEventListener('abort',cancel);resolve(reader.result);};
    reader.onerror=()=>{signal.removeEventListener('abort',cancel);reject(new Error('첨부 인코딩 실패'));};
    if(signal.aborted)return cancel();reader.readAsDataURL(blob);
  });
  return {uri,bytes:blob.size,type:blob.type};
}
module.exports={Journal,MediaCache,allowedUrl,fetchData};


},
"./plugin":function(module,exports,require){
'use strict';
const {clone}=require('./core');
const {normalizeMessage,validEditTime,editTime,verifiedEdits,isLocalTemporary}=require('./mobile');
const {Engine}=require('./engine');
const {createUI,sortArchiveRows}=require('./ui');
const {Journal,MediaCache,fetchData}=require('./io');
function createPlugin(api,definePlugin) {
  let React,RN,stores,archive,journal,media,timer,base,UI,maintenanceTimer,backupTimer,selfTestTimer,fetchActions,started=false,dirty=false;
  let diagnostics={nativeTextShape:'아직 수집되지 않음'},lastTest=0,stopping=false;const fetchTimes=new Map(),nativeSeen=new Map(),nativeRenderedSeen=new Map(),nativeRecordBefore=new Map(),temporaryIds=new Set(),temporaryRecords=new Map(),nativeContentSeen=new Map(),nativePainted=new Map();
  let status='시작 대기',inlineReady=false,unpatches=[],listeners=new Set();
  const pendingRefresh=new Set();let refreshScheduled=false;
  const notify=()=>{for(const cb of listeners)cb();};
  const error=e=>{status=String(e?.message||e);notify();console.error('[Message Archive]',e);};
  const save=()=>{
    dirty=true;notify();
    if(!timer)timer=setTimeout(()=>{timer=null;flush().catch(error);},1000);
  };
  async function flush(){
    if(timer){clearTimeout(timer);timer=null;}
    if(dirty&&archive&&journal){
      await api.modules.native.fs.writeFile(base+'/settings.json',JSON.stringify(archive.options));
      if(!archive.options.dontSaveData){dirty=false;try{await journal.save({...archive.data(),localTemporaryRecords:[...temporaryRecords.values()]});}catch(e){dirty=true;throw e;}
        if(archive.options.autoBackup&&!stopping){if(backupTimer)clearTimeout(backupTimer);backupTimer=setTimeout(()=>{backupTimer=null;backup().catch(error);},20000);}}
    }
    await journal?.flush();
  }
  function rawMessage(e) {
    const raw=e?.message||e;if(!raw)return null;
    const channel=raw.channel_id||raw.channelId||e.channelId||e.channel_id;
    const old=archive?.lookup(raw.id)||previous(raw.id,channel);
    const out=normalizeMessage(raw,channel,old,e.type);if(!out)return raw;
    out.guild_id=raw.guild_id||raw.guildId||stores.ChannelStore?.getChannel?.(channel)?.guild_id;
    return out;
  }
  function localAttachments(message){const out=clone(message);for(const attachment of out.attachments||[]){const uri=media?.index[attachment.id]?.localUri;if(uri){attachment.url=uri;attachment.proxy_url=uri;}}return out;}
  function archiveLocation(message){
    const channel=stores?.ChannelStore?.getChannel?.(message.channel_id);
    const guildId=message.guild_id||channel?.guild_id;
    if(channel?.type===1||channel?.type===3||guildId==='@me'){
      const recipients=(channel?.recipients||[]).map(id=>stores?.UserStore?.getUser?.(id)).filter(Boolean);
      const name=channel?.name||recipients.map(user=>user.global_name||user.username||user.id).join(', ');
      return (channel?.type===3?'그룹 DM':'DM')+' · '+(name||'채널 ID '+message.channel_id);
    }
    const guild=guildId?stores?.GuildStore?.getGuild?.(guildId):null;
    return (guild?.name||(guildId?'서버 ID '+guildId:'서버 정보 없음'))+' · '+(channel?.name?'#'+channel.name:'채널 ID '+message.channel_id);
  }
  function previous(messageId,channel){try{return stores.MessageStore?.getMessage?.(channel,messageId);}catch(_){return null;}}
  function cacheAttachments(m){for(const a of m?.attachments||[]){const url=a.proxy_url||a.url;
    if(archive.options.cacheOtherFiles||/\.(jpe?g|png|gif|bmp)(?:$|\?)/i.test(url||''))media?.enqueue({...a,url});}}
  async function backup(){if(!archive.options.dontSaveData){await api.modules.native.fs.writeFile(base+'/backup.json',JSON.stringify({...archive.data(),localTemporaryRecords:[...temporaryRecords.values()]}));status='백업 저장됨';notify();}}
  function refreshChat(id){notify();if(!id)return;const r=archive.records.get(id);if(!r)return;
    if(r.localTemporary||isLocalTemporary(r.message))return;
    if(!r.deletedAt&&!verifiedEdits(archive,id).length)return;
    // Typed Flux listeners run after Discord has already removed the message.
    // MESSAGE_UPDATE cannot resurrect that missing record; retain it in the
    // archive and let LOAD_MESSAGES_SUCCESS restore it through the normal path.
    const live=previous(id,r.message.channel_id);
    if(!live||isLocalTemporary(live)){
      diagnostics.refreshMissingMessagesSkipped=(diagnostics.refreshMissingMessagesSkipped||0)+1;return;
    }
    const event=r.hidden?{type:'MESSAGE_DELETE',id,channelId:r.message.channel_id,ML2:true}:{type:'MESSAGE_UPDATE',message:localAttachments(r.message),__loggerReplay:true};
    try{api.discord.common?.flux?.Dispatcher?.dispatch?.(event);diagnostics.chatRefreshes=(diagnostics.chatRefreshes||0)+1;}
    catch(e){diagnostics.chatRefreshError=String(e?.message||e);}
  }
  function scheduleRefresh(id){
    if(!id)return;pendingRefresh.add(id);if(refreshScheduled)return;refreshScheduled=true;
    Promise.resolve().then(()=>{
      refreshScheduled=false;const ids=[...pendingRefresh];pendingRefresh.clear();
      if(started)for(const id of ids)refreshChat(id);
    });
  }
  function effect(items){for(const item of items){
    if(item.type==='changed')save();
    else if(item.type==='cacheMedia')cacheAttachments(item.message);
    else if(item.type==='selfTest')lastTest=Date.now();
    else if(item.type==='refresh')scheduleRefresh(item.messageId);
    else if(item.type==='prefetch'&&fetchActions?.fetchMessages&&Date.now()-(fetchTimes.get(item.channelId)||0)>10000){
      fetchTimes.set(item.channelId,Date.now());Promise.resolve().then(()=>fetchActions.fetchMessages({channelId:item.channelId,limit:50})).catch(error);
    }else if(item.type==='notification'){
      const channel=stores.ChannelStore?.getChannel?.(item.channelId);const name=channel?.name?'#'+channel.name:'DM';
      const label={sent:'새 메시지',edited:'메시지 수정',deleted:item.bulk?'일괄 삭제':'메시지 삭제',ghostPings:'고스트 핑',spamBlocked:'수정 알림 1분 차단'}[item.kind]||item.kind;
      const text=item.kind==='count'?name+': 새 '+item.countKind+' '+item.count+'개':label+' · '+name;
      try{if(typeof api.discord.actions?.ToastActionCreators?.open==='function')api.discord.actions.ToastActionCreators.open({content:text,duration:4500,source:'message-logger'});
        else RN.ToastAndroid?.show?.(text,RN.ToastAndroid.SHORT);}catch(e){diagnostics.notifications=e.message;}
    }
  }notify();}
  function patchActions(){const find=api.modules.finders;if(!find?.waitForModules)return;
    unpatches.push(find.waitForModules(find.filters.withProps('fetchMessages','deleteMessage'),mod=>{
      fetchActions=mod;diagnostics.prefetch='connected';
      unpatches.push(api.patcher.instead(mod,'deleteMessage',function(args,original){if(started){if(archive.records.get(args[1])?.deletedAt)return;archive.markLocalDelete(args[1]);}return original.apply(this,args);}));
      if(typeof mod.startEditMessage==='function')unpatches.push(api.patcher.instead(mod,'startEditMessage',function(args,original){if(started&&archive.records.get(args[1])?.kinds.deleted)return;return original.apply(this,args);}));
      if(archive.options.aggresiveMessageCaching&&archive.selected)effect([{type:'prefetch',channelId:archive.selected}]);
    },{cached:true}));
    const store=stores.MessageStore;
    if(typeof store?.getLastEditableMessage==='function')unpatches.push(api.patcher.instead(store,'getLastEditableMessage',function(args,original){
      const candidate=original.apply(this,args);if(!started||!candidate||!archive.records.get(candidate.id)?.deletedAt)return candidate;
      return (this.getMessages(args[0])?.toArray?.()||[]).slice().reverse().find(m=>m.author?.id===archive.userId&&m.state==='SENT'&&!archive.records.get(m.id)?.deletedAt);
    }));
    function LogButton({messageId}){const [open,setOpen]=React.useState(false),record=archive.records.get(messageId);
      return React.createElement(RN.View,null,React.createElement(RN.Pressable,{onPress:()=>setOpen(true),style:{padding:12}},React.createElement(RN.Text,{style:{color:'#7eaaff'}},archive.options.contextmenuSubmenuName)),
        open?(record?React.createElement(UI.Actions,{record,onClose:()=>setOpen(false)}):React.createElement(RN.Modal,{visible:true,onRequestClose:()=>setOpen(false)},React.createElement(RN.View,{style:{flex:1}},React.createElement(RN.Pressable,{onPress:()=>setOpen(false),style:{padding:16}},React.createElement(RN.Text,{style:{color:'#7eaaff'}},'닫기')),React.createElement(SettingsComponent)))):null);
    }
    for(const name of ['MessageActionSheet','ChannelHeader'])unpatches.push(find.waitForModules(find.filters.withProps(name),mod=>{
      if(typeof mod[name]!=='function')return;
      unpatches.push(api.patcher.instead(mod,name,function(args,original){const out=original.apply(this,args);
        if(!started||archive.options.streamMode||(name==='ChannelHeader'&&!archive.options.showOpenLogsButton))return out;
        diagnostics[name]='connected';return React.createElement(RN.View,null,out,React.createElement(LogButton,{messageId:args[0]?.message?.id}));
      }));
    },{cached:true}));
  }
  function on(type,cb){unpatches.push(api.discord.flux.onFluxEventDispatched(type,payload=>{
    if(!started)return payload;
    try {
      const current=stores.UserStore?.getCurrentUser?.()?.id;
      if(!current||current!==archive.userId){started=false;media?.stop();error(new Error('계정이 바뀌었습니다. 앱을 다시 시작하세요.'));return payload;}
      if(payload.__loggerReplay)return payload;return cb(payload);
    }catch(e){error(e);return payload;}
  }));}
  function colorText(node,color,depth=0) {
    if(depth>12||!React.isValidElement(node))return node;
    const props={};
    if(node.type===RN.Text)props.style=[node.props.style,{color}];
    if(node.props.children!=null)props.children=React.Children.map(node.props.children,c=>colorText(c,color,depth+1));
    return React.cloneElement(node,props);
  }
  function nativeHistoryNodes(content,modifier,deleted,suffix={type:'subtext'}){
    const body=clone(content);
    const tag=modifier.noSuffix?null:{...clone(suffix),content:[{type:'text',content:' (수정됨)'}]};
    // Native subtext supplies muted text and terminates each historical line.
    // Current content stays outside the span with its original size and color.
    if(deleted&&body.every(node=>node?.type==='text'&&typeof node.content==='string'))
      return [{...clone(suffix),content:[...body,...(tag?tag.content:[])]}];
    // Keep code blocks, lists, quotes, embeds and already parsed rich spans at
    // their native level. Never place block AST or another subtext inside subtext.
    if(deleted)diagnostics.nativeRichHistoryFallbacks=(diagnostics.nativeRichHistoryFallbacks||0)+1;
    return [...body,tag||{type:'text',content:'\n'}];
  }
  function markTemporary(id){
    if(!id)return;
    temporaryIds.add(id);nativeSeen.delete(id);nativeRenderedSeen.delete(id);nativeRecordBefore.delete(id);nativeContentSeen.delete(id);nativePainted.delete(id);archive.cache.delete(id);
    const record=archive.records.get(id);
    if(record){temporaryRecords.set(id,{...clone(record),localTemporary:true});archive.records.delete(id);save();}
    while(temporaryIds.size>archive.options.messageCacheCap)temporaryIds.delete(temporaryIds.values().next().value);
    diagnostics.temporaryMessagesSkipped=(diagnostics.temporaryMessagesSkipped||0)+1;
  }
  function temporaryMessage(id,channel){
    return temporaryIds.has(id)||archive.records.get(id)?.localTemporary
      ||isLocalTemporary(previous(id,channel))||isLocalTemporary(archive.cache.get(id))||isLocalTemporary(archive.records.get(id)?.message);
  }
  function syncSelectedChannel(){
    const selected=stores.SelectedChannelStore?.getChannelId?.();
    if(typeof selected==='string'&&selected&&archive.selected!==selected){
      archive.selected=selected;diagnostics.selectedChannelResynced=(diagnostics.selectedChannelResynced||0)+1;
    }
  }
  function nativeBaseline(m){
    const rendered=nativeRenderedSeen.get(m.id),candidate=nativeRecordBefore.get(m.id);
    if(candidate?.after===m.content&&candidate.before.channel_id===m.channel_id)return candidate.before;
    if(rendered&&rendered.channel_id===m.channel_id&&rendered.content!==m.content)return rendered;
  }
  function observeRenderedMessage(raw,rendered,source,trustedInput=false){
    const m=normalizeMessage(raw);if(!m||typeof m.content!=='string'||!m.author?.id||isLocalTemporary(raw))return observeNativeMessage(raw,undefined,source);
    const time=editTime(rendered?.editedTimestamp)||editTime(rendered?.edited_timestamp);
    const times=diagnostics.nativeRenderedTimes||(diagnostics.nativeRenderedTimes={valid:0,empty:0,invalid:0});
    times[time?'valid':rendered?.editedTimestamp==null?'empty':'invalid']++;
    // Bridge rows may lag MessageStore. Pair the rendered timestamp with a body
    // only when it is generated from this input, or is an exact plain-text match.
    const matchingId=!rendered?.id||rendered.id===m.id;
    const matchingChannel=!rendered?.channelId||rendered.channelId===m.channel_id;
    const plain=Array.isArray(rendered?.content)&&rendered.content.every(n=>n.type==='text'&&typeof n.content==='string')
      ?rendered.content.map(n=>n.content).join(''):null;
    const matches=matchingId&&matchingChannel&&(trustedInput||plain===m.content);
    observeNativeMessage(raw,nativeBaseline(m),source,matches?time:undefined);
    if(matches){
      if(time&&(!validEditTime(m.edited_timestamp)||Date.parse(time)>Date.parse(m.edited_timestamp)))m.edited_timestamp=time;
      nativeRenderedSeen.set(m.id,m);
      while(nativeRenderedSeen.size>archive.options.messageCacheCap)nativeRenderedSeen.delete(nativeRenderedSeen.keys().next().value);
    }
  }
  function observeNativeMessage(message,before,source='native',renderedTime){
    syncSelectedChannel();
    if(isLocalTemporary(message)){markTemporary(message?.id);return;}
    const m=normalizeMessage(message);if(!m||typeof m.content!=='string'||!m.author?.id)return;
    temporaryIds.delete(m.id);
    diagnostics.nativeInputEditTime=validEditTime(m.edited_timestamp)?'valid':('editedTimestamp' in message||'edited_timestamp' in message)?'empty/invalid':'absent';
    diagnostics.nativeInputFields={content:typeof message.content,editedTimestamp:typeof message.editedTimestamp,edited_timestamp:typeof message.edited_timestamp};
    const times=diagnostics.nativeInputTimes||(diagnostics.nativeInputTimes={valid:0,empty:0,unsupported:0});
    const value=message.edited_timestamp??message.editedTimestamp;
    times[validEditTime(m.edited_timestamp)?'valid':value==null?'empty':'unsupported']++;
    if(value&&typeof value==='object')diagnostics.nativeTimeObject={toISOString:typeof value.toISOString,toISO:typeof value.toISO,toJSON:typeof value.toJSON};
    if(message.__vml_edits?.length||message.__vml_currentContent!==undefined){
      diagnostics.externalNativeHistorySeen=true;return;
    }
    if(validEditTime(renderedTime)&&(!validEditTime(m.edited_timestamp)||Date.parse(renderedTime)>Date.parse(m.edited_timestamp))&&value!=='invalid_timestamp'){
      m.edited_timestamp=renderedTime;diagnostics.nativeRenderedTimeUsed=(diagnostics.nativeRenderedTimeUsed||0)+1;
    }
    const record=archive.records.get(m.id);
    const proven=record&&['event','native','record','bridge'].includes(record.editEvidenceSource)&&Number.isInteger(record.verifiedHistoryStart);
    const prior=before&&before.id===m.id&&before.channel_id===m.channel_id&&before.content!==m.content?before:nativeSeen.get(m.id)||(proven?record.message:null);
    const priorTime=Math.max(Date.parse(prior?.edited_timestamp)||0,proven?Date.parse(record.message.edited_timestamp)||0:0);
    const skips=diagnostics.nativeEditChecks||(diagnostics.nativeEditChecks={noBaseline:0,unchanged:0,noTime:0,staleTime:0,alreadySaved:0,filtered:0,captured:0});
    if(!prior)skips.noBaseline++;
    else if(prior.content===m.content)skips.unchanged++;
    else if(!validEditTime(m.edited_timestamp))skips.noTime++;
    else if(Date.parse(m.edited_timestamp)<=priorTime)skips.staleTime++;
    else if(proven&&record.message.content===m.content)skips.alreadySaved++;
    // A render can contain an older or timestamp-less record. It must never
    // revoke proof from an actual update; only a server load may do that.
    if(prior&&prior.channel_id===m.channel_id&&prior.content!==m.content&&validEditTime(m.edited_timestamp)
      &&Date.parse(m.edited_timestamp)>priorTime&&(!proven||record.message.content!==m.content)){
      // A genuine native edit requires both a changed body and an advancing
      // server edit timestamp. Content-only refreshes are never edits.
      const count=record?.history.length||0;
      const channel=archive.channel(m.channel_id);
      const author=archive.context.getUser?.(m.author.id)||m.author;
      const allowed=channel&&archive.policy(channel)&&archive.authorAllowed(author,{type:'MESSAGE_UPDATE'})&&[0,19,20].includes(m.type)&&!(m.type===20&&(m.flags||0)&64);
      const tail=record?.history[count-1];
      // The archive may already contain this edge without display proof. A
      // matching current body is not evidence that the history is renderable.
      // Verify only the tail witnessed in this live old -> new transition.
      const reconcile=!proven&&record?.message.content===m.content&&allowed&&tail
        &&prior.author?.id===m.author.id&&!isLocalTemporary(prior)
        &&tail.message?.id===m.id&&tail.message.channel_id===m.channel_id
        &&tail.message.author?.id===m.author.id&&!isLocalTemporary(tail.message)
        &&tail.message.content===prior.content;
      let out,proofStart=count;
      if(reconcile){
        proofStart=count-1;out={effects:[{type:'changed'}]};
        diagnostics.nativeHistoriesReconciled=(diagnostics.nativeHistoriesReconciled||0)+1;
      }else{
        // Run normal engine filters on a staged copy. A rejected edit must not
        // overwrite the archived current body just to test the transition.
        if(record&&!proven){const staged=clone(record);staged.message.content=prior.content;archive.records.set(m.id,staged);}
        archive.cache.set(m.id,clone(prior));
        out=archive.process({type:'MESSAGE_UPDATE',message:m});
      }
      const changed=archive.records.get(m.id);
      if(changed&&(reconcile||changed.history.length>count)){
        if(!proven)changed.verifiedHistoryStart=proofStart;
        changed.editEvidence=m.edited_timestamp;changed.editEvidenceSource=source;
        changed.message.edited_timestamp=m.edited_timestamp;
        diagnostics.nativeObservedEdits=(diagnostics.nativeObservedEdits||0)+1;
        if(source==='record')diagnostics.nativeRecordEdits=(diagnostics.nativeRecordEdits||0)+1;
        skips.captured++;nativeRecordBefore.delete(m.id);
      }else{
        if(record&&!proven)archive.records.set(m.id,record);
        skips.filtered++;
        const channel=archive.channel(m.channel_id);
        diagnostics.nativeEditFilter={channelFound:!!channel,selected:archive.selected===m.channel_id,channelAllowed:!!channel&&archive.policy(channel),authorAllowed:archive.authorAllowed(m.author,{type:'MESSAGE_UPDATE'})};
      }
      effect(out.effects);
    }
    nativeSeen.set(m.id,m);
    archive.cache.set(m.id,clone(m));
    const cap=archive.options.messageCacheCap;
    while(nativeSeen.size>cap)nativeSeen.delete(nativeSeen.keys().next().value);
    while(archive.cache.size>cap)archive.cache.delete(archive.cache.keys().next().value);
  }
  function patchNativeBridge(){
    const wait=api.discord.native?.waitForNativeBridge;if(!wait)return;
    unpatches.push(wait(target=>{
      unpatches.push(api.patcher.instead(target,'updateRows',function(args,original){
        if(!started)return original.apply(this,args);
        diagnostics.nativeBridgeCalls++;
        // DCDChat updateRows takes the native view id and serialized row array.
        // Malformed or unrelated payloads must be forwarded exactly as received.
        if(typeof args[1]!=='string')return original.apply(this,args);
        let rows;
        try{rows=JSON.parse(args[1]);}catch(_){return original.apply(this,args);}
        if(!Array.isArray(rows))return original.apply(this,args);
        let changed=false;
        try{syncSelectedChannel();for(const row of rows){
          const message=row?.message;if(!message?.id||!message.channelId||!Array.isArray(message.content))continue;
          diagnostics.nativeBridgeMessageRows++;
          const live=previous(message.id,message.channelId);
          if(live)diagnostics.nativeBridgeStoreMatches++;
          if(isLocalTemporary(message)||isLocalTemporary(live)){markTemporary(message.id);continue;}
          const signature=JSON.stringify(message.content),painted=nativePainted.get(message.id),alreadyPainted=painted?.signature===signature;
          const priorContent=nativeContentSeen.get(message.id);
          if(live)observeRenderedMessage(live,message,'bridge');
          const r=archive.records.get(message.id);
          // Keep Discord's parsed old content when it matches a confirmed saved
          // version. This preserves mentions/emoji/formatting without reparsing.
          if(r&&priorContent)for(const version of verifiedEdits(archive,message.id)){
            const saved=r.history[version.index];
            if(saved&&!saved.nativeContent&&saved.message.content===priorContent.body){saved.nativeContent=clone(priorContent.nodes);save();}
          }
          const raw=live&&normalizeMessage(live,message.channelId);
          const plain=message.content.every(n=>n.type==='text'&&typeof n.content==='string')?message.content.map(n=>n.content).join(''):null;
          if(!alreadyPainted&&typeof raw?.content==='string'&&(plain==null||plain===raw.content))nativeContentSeen.set(message.id,{body:raw.content,nodes:clone(message.content)});
          if(!r||r.localTemporary||!archive.options.inlineEnabled||archive.options.streamMode)continue;
          const edits=verifiedEdits(archive,message.id),deleted=archive.canShowDeleted(r),modifier=archive.modifiers.get(message.id)||{};
          const current=alreadyPainted?painted.current:message.content;
          if(edits.length&&(!alreadyPainted||painted.deleted!==deleted)){
            const nodes=[];
            for(const version of edits){
              nodes.push(...nativeHistoryNodes(version.nativeContent||[{type:'text',content:version.message.content}],modifier,deleted));
            }
            if(modifier.editNum==null)nodes.push(...clone(current));
            message.content=nodes;message.edited=null;changed=true;diagnostics.nativeBridgeHistoriesShown++;
          }
          if(edits.length||deleted&&!archive.noTint.has(message.id)){
            const process=RN.processColor||((value)=>value);
            row.backgroundHighlight={...row.backgroundHighlight,backgroundColor:process(deleted?'#ed424533':'#949ba422'),gutterColor:process(deleted?archive.options.deletedMessageColor:archive.options.editedMessageColor)};
            changed=true;
          }
          if(deleted&&!edits.length){message.edited='삭제됨';changed=true;}
          else if(edits.length&&message.edited!=null){message.edited=null;changed=true;}
          if(edits.length)nativePainted.set(message.id,{signature:JSON.stringify(message.content),deleted,current:clone(current)});
        }
        const cap=archive.options.messageCacheCap;
        for(const map of [nativeContentSeen,nativePainted])while(map.size>cap)map.delete(map.keys().next().value);
        }catch(e){diagnostics.nativeBridgeError=String(e.message);return original.apply(this,args);}
        return original.apply(this,changed?[args[0],JSON.stringify(rows),...args.slice(2)]:args);
      }));
      diagnostics.nativeBridge='updateRows connected';inlineReady=true;notify();
    },stage=>{diagnostics.nativeBridge=stage;notify();}));
  }
  function patchRecordUpdates(){
    const find=api.modules.finders;if(!find?.waitForModules)return;
    unpatches.push(find.waitForModules(find.filters.withProps('createMessageRecord','updateMessageRecord'),records=>{
      if(typeof records.updateMessageRecord!=='function')return;
      unpatches.push(api.patcher.instead(records,'updateMessageRecord',function(args,original){
        // Snapshot before Discord mutates/replaces the old record. This also
        // captures the first edit when no RowManager render has been observed.
        const before=started?normalizeMessage(args[0]):null;
        const result=original.apply(this,args);
        if(started){
          diagnostics.nativeRecordUpdatesSeen=(diagnostics.nativeRecordUpdatesSeen||0)+1;
          try{
            const after=normalizeMessage(result);
            const foreign=args[1]?.__vml_edits?.length||args[1]?.__vml_restore_edit||args[1]?.edited_timestamp==='invalid_timestamp';
            if(!foreign&&before&&after&&typeof before.content==='string'&&typeof after.content==='string'&&before.id===after.id&&before.channel_id===after.channel_id&&before.content!==after.content&&!isLocalTemporary(result)&&!isLocalTemporary(before)){
              nativeRecordBefore.set(after.id,{before,after:after.content});
              while(nativeRecordBefore.size>archive.options.messageCacheCap)nativeRecordBefore.delete(nativeRecordBefore.keys().next().value);
            }
            if(!foreign)
              observeNativeMessage(result,before,'record');
          }catch(e){diagnostics.nativeRecordError=String(e.message);}
        }
        return result;
      }));
      diagnostics.nativeRecords='updateMessageRecord connected';notify();
    },{cached:true}));
  }
  function patchNativeRows(){
    const wait=api.discord.native?.waitForNativeRows;if(!wait)return;
    unpatches.push(wait((rows,records)=>{
      unpatches.push(api.patcher.instead(rows,'generate',function(args,original){
        const data=args[0],message=data?.message;
        const generated=original.apply(this,args);
        if(started&&data?.rowType===1)try{diagnostics.nativeRowsGenerated=(diagnostics.nativeRowsGenerated||0)+1;observeRenderedMessage(message,generated?.message,'native',true);}catch(e){diagnostics.nativeObservationError=String(e.message);}
        const r=archive?.records.get(message?.id);
        if(!started||data?.rowType!==1||!r||r.localTemporary||isLocalTemporary(message)||!archive.options.inlineEnabled||archive.options.streamMode)return generated;
        const deleted=archive.canShowDeleted(r),edits=verifiedEdits(archive,message.id),modifier=archive.modifiers.get(message.id)||{};
        if(!generated||typeof generated!=='object')return generated;
        const row={...generated,message:generated.message?{...generated.message}:generated.message};
        const currentContent=Array.isArray(row.message?.content)?clone(row.message.content):null;
        let historyApplied=false;
        if(edits.length&&typeof records.createMessageRecord==='function'){
          // Native `edited` is appended once at the very end of a row. For
          // per-version suffixes use Discord's own subtext node inline after
          // each old body; its native renderer supplies the small muted span.
          const raw=normalizeMessage(message,r.message.channel_id,r.message);
          const renderContent=content=>{
            const display=records.createMessageRecord({...raw,content},message.reactions);
            return original.apply(this,[{...data,message:display},...args.slice(1)])?.message?.content;
          };
          try{
            if(Array.isArray(row.message?.content)){
              const parts=[],separator=renderContent('\n');
              const suffix=modifier.noSuffix?null:renderContent('-# (수정됨)');
              const subtext=Array.isArray(suffix)?suffix.find(n=>n.type==='subtext'):null;
              if(!modifier.noSuffix&&!subtext)throw Error('native subtext node unavailable');
              const append=value=>{if(!Array.isArray(value))throw Error('native content array required');parts.push(...value);};
              for(const version of edits){
                const content=renderContent(version.message.content);
                if(deleted){if(!Array.isArray(content))throw Error('native content array required');parts.push(...nativeHistoryNodes(content,modifier,true,subtext||{type:'subtext'}));}
                else{append(content);if(subtext)parts.push({...clone(subtext),content:[{type:'text',content:' (수정됨)'}]});else append(separator);}
              }
              if(modifier.editNum==null)append(row.message.content);
              row.message.content=parts;
            }else{
              const versions=edits.map(v=>v.message.content+(modifier.noSuffix?'':' (수정됨)'));
              row.message.content=[...versions,...(modifier.editNum==null?[r.message.content]:[])].join('\n');
            }
            historyApplied=true;diagnostics.nativeRowsHistoriesShown=(diagnostics.nativeRowsHistoriesShown||0)+1;
          }catch(e){diagnostics.nativeHistory=e.message;}
          finally{original.apply(this,args);}
        }
        if(typeof diagnostics.nativeTextShape!=='object'){
          let remaining=500;
          const seen=new WeakSet();
          const shape=(value,depth=0)=>{
            if(value==null)return String(value);
            if(typeof value!=='object')return typeof value;
            if(depth>=7||remaining--<=0)return 'object (depth/budget limit)';
            if(seen.has(value))return 'object (shared reference)';
            seen.add(value);
            if(Array.isArray(value))return value.length?value.slice(0,2).map(v=>shape(v,depth+1)):'empty array';
            const out={};
            // Root fields must not be truncated: native content follows metadata.
            const keys=Object.keys(value);
            keys.sort((a,b)=>Number(/content|text|span|markdown|style|attribute/i.test(b))-Number(/content|text|span|markdown|style|attribute/i.test(a)));
            for(const key of keys){
              try{out[key]=shape(value[key],depth+1);}catch(e){out[key]='unreadable';}
            }
            return out;
          };
          diagnostics.nativeMessageKeys=Object.keys(row.message||{});
          diagnostics.nativeTextShape=shape(row.message);notify();
        }
        const color=deleted?archive.options.deletedMessageColor:archive.options.editedMessageColor;
        const process=RN.processColor||((value)=>value);
        if((deleted&&!archive.noTint.has(message.id))||edits.length){
          row.backgroundHighlight={...row.backgroundHighlight,backgroundColor:process(deleted?'#ed424533':'#949ba422'),gutterColor:process(color)};
        }
        if(row.message){row.message={...row.message,edited:edits.length?null:deleted?'삭제됨':row.message.edited};}
        if(historyApplied&&Array.isArray(row.message?.content))nativePainted.set(message.id,{signature:JSON.stringify(row.message.content),deleted,current:currentContent});
        return row;
      }));
      diagnostics.nativeRows='RowManager.generate connected';inlineReady=true;notify();
    },stage=>{if(diagnostics.nativeRows!==stage){diagnostics.nativeRows=stage;notify();}}));
  }
  function patchInline() {
    // Only patch an identified named export; no scan/string heuristics over every React module.
    const find=api.modules.finders;
    if(!find?.waitForModules||!find.filters?.withProps)return;
    unpatches.push(find.waitForModules(find.filters.withProps('MessageContent'),mod=>{
      if(diagnostics.reactContent)return;
      let parent=mod,key='MessageContent';
      if(typeof mod.MessageContent!=='function'&&typeof mod.MessageContent?.type==='function'){
        parent=mod.MessageContent;key='type';
      }
      if(typeof parent[key]!=='function')return;
      const undo=api.patcher.instead(parent,key,function(args,original){
        const result=original.apply(this,args);
        if(!started||!archive.options.inlineEnabled||archive.options.streamMode)return result;
        const message=args[0]?.message;if(!message?.id)return result;
        const r=archive.records.get(message.id);if(!r||r.localTemporary||isLocalTemporary(message)||!(r.deletedAt||r.history.length))return result;
        if(!archive.canShowDeleted(r)&&!verifiedEdits(archive,message.id).length)return result;
        try {
          const shown=archive.canShowDeleted(r),edits=verifiedEdits(archive,message.id),editedDeletion=shown&&edits.length>0;const modifier=archive.modifiers.get(message.id)||{};
          const painted=editedDeletion?result:shown&&!archive.noTint.has(message.id)?(archive.options.useAlternativeDeletedStyle?React.createElement(RN.View,{style:{backgroundColor:'#ed424533'}},result):typeof r.message.content==='string'&&r.message.content.length?React.createElement(RN.Text,{style:{color:archive.options.deletedMessageColor,fontSize:16}},r.message.content):colorText(result,archive.options.deletedMessageColor)):result;
          const children=[];
          if(shown&&!editedDeletion)children.unshift(React.createElement(RN.Text,{key:'deleted',style:{color:'#ed4245',fontSize:11}},'삭제된 메시지'));
          for(const version of edits)children.push(React.createElement(RN.Text,{key:'edit-'+version.index,style:{color:archive.options.editedMessageColor,opacity:0.7}},version.message.content,modifier.noSuffix?null:React.createElement(RN.Text,{style:{color:'#949ba4',fontSize:11,opacity:1}},' (수정됨)')));
          if(modifier.editNum==null)children.push(painted);
          if(verifiedEdits(archive,message.id).length<Math.max(0,r.history.length-(r.verifiedHistoryStart??r.history.length))&&!r.editsHidden&&archive.options.showEditedMessages)children.push(React.createElement(RN.Pressable,{key:'all',onPress:()=>{archive.modifiers.set(message.id,{showAllEdits:true});refreshChat(message.id);}},React.createElement(RN.Text,{style:{color:'#949ba4'}},'수정 이력 모두 보기')));
          return React.createElement(RN.View,{style:editedDeletion&&!archive.noTint.has(message.id)?{backgroundColor:'#ed424533'}:edits.length?{backgroundColor:'#949ba422'}:undefined},...children);
        }catch(_){return result;}
      });
      unpatches.push(undo);diagnostics.reactContent='MessageContent connected';inlineReady=true;notify();
    },{cached:true}));
  }
  function Attachment({attachment}) {
    const [uri,setUri]=React.useState(null);
    React.useEffect(()=>{let live=true;media?.get(attachment.id).then(u=>{if(live)setUri(u);});return()=>{live=false;};},[attachment.id]);
    const mime=attachment.content_type||media?.index[attachment.id]?.type||'';
    const source=media?.index[attachment.id]?.localUri||uri||attachment.url||attachment.proxy_url;
    return React.createElement(RN.View,{style:{marginTop:8}},
      /^image\//.test(mime)||/\.(png|jpe?g|gif|webp)$/i.test(attachment.filename||'')?
        React.createElement(RN.Image,{source:{uri:source},resizeMode:'contain',style:{height:180,width:'100%'}}):null,
      React.createElement(RN.Text,{style:{color:'#b5bac1',fontSize:12}},
        (attachment.filename||attachment.id||'첨부파일')+(uri?' · 기기에 저장됨':' · 원본 링크')),
      React.createElement(RN.Pressable,{onPress:()=>{
        if(attachment.url)RN.Linking.openURL(attachment.url).catch(error);
      },style:{paddingVertical:8}},React.createElement(RN.Text,{style:{color:'#7eaaff'}},'원본 열기')),
      media?.index[attachment.id]?.localUri?React.createElement(RN.Pressable,{onPress:()=>RN.Share.share({url:source,message:source}).catch(error),style:{paddingVertical:8}},React.createElement(RN.Text,{style:{color:'#7eaaff'}},'로컬 파일 공유 (기기 지원 필요)')):null,
      uri?React.createElement(RN.Text,{style:{color:'#949ba4',fontSize:11}},/^image\//.test(mime)?'오프라인 미리보기 가능':'바이트 캐시됨 · 파일 공유 지원은 기기별 확인 필요'):null);
  }
  function SettingsComponent() {
    // The settings screen can be opened while the plugin is disabled.
    if(!React||!RN){React=api.react.React;RN=api.react.ReactNative;}
    const [,refresh]=React.useState(0),[query,setQuery]=React.useState(''),[kind,setKind]=React.useState('all');
    const [action,setAction]=React.useState(null),[diagnosticOpen,setDiagnosticOpen]=React.useState(false);
    const [limit,setLimit]=React.useState(archive?.options.renderCap||50);
    React.useEffect(()=>{const fn=()=>refresh(n=>n+1);listeners.add(fn);return()=>listeners.delete(fn);},[]);
    const h=React.createElement,{View,Text,Pressable,Switch,TextInput,FlatList}=RN;
    const text=(s,style={})=>h(Text,{style:{color:'#f2f3f5',...style}},s);
    const button=(name,fn)=>h(Pressable,{key:name,onPress:fn,style:{padding:10,backgroundColor:'#404249',borderRadius:7,margin:3}},text(name));
    const toggle=(label,key)=>h(View,{key,style:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',paddingVertical:6}},
      text(label,{flex:1}),h(Switch,{value:!!archive?.options[key],disabled:!started,onValueChange:v=>{archive.options[key]=v;save();}}));
    const logs=sortArchiveRows((archive?.logs(query,kind)||[]).filter(r=>!r.localTemporary&&!isLocalTemporary(r.message)&&(kind==='sent'||r.deletedAt||verifiedEdits(archive,r.message.id).length)),archive?.options.oldestActivityFirst===true);
    const proofStats=archive?{verified:[...archive.records.values()].filter(r=>Number.isInteger(r.verifiedHistoryStart)&&r.editEvidenceSource).length,visible:[...archive.records.keys()].filter(id=>verifiedEdits(archive,id).length).length}:undefined;
    const diagnosticText=JSON.stringify({version:api.pluginVersion||'0.4.17',status,started,inlineReady,...diagnostics,stats:archive?.stats(),editProof:proofStats},null,2);
    const copyDiagnostic=()=>{if(api.clipboard?.setString){api.clipboard.setString(diagnosticText);status='진단 복사됨';notify();}else if(RN.Clipboard?.setString){RN.Clipboard.setString(diagnosticText);}else RN.Share?.share?.({message:diagnosticText}).catch(error);};
    const header=h(View,null,text('Message Archive v'+(api.pluginVersion||'0.4.17'),{fontSize:22,fontWeight:'bold'}),
      text(status,{color:'#b5bac1',marginVertical:10}),
      text('실제 화면 호출: updateRows '+(diagnostics.nativeBridgeMessageRows||0)+' · RowManager '+(diagnostics.nativeRowsGenerated||0)+' · 레코드 갱신 '+(diagnostics.nativeRecordUpdatesSeen||0),{color:'#949ba4',fontSize:12}),
      h(View,{style:{flexDirection:'row'}},button('연결 진단 보기',()=>setDiagnosticOpen(true)),button('진단 복사',copyDiagnostic)),
      UI?h(UI.Options):null,
      h(TextInput,{value:query,onChangeText:v=>{setQuery(v);setLimit(archive?.options.renderCap||50);},placeholder:'내용 / 작성자 / 채널 ID 검색',placeholderTextColor:'#949ba4',
        style:{color:'white',backgroundColor:'#232428',padding:10,borderRadius:6,marginVertical:12}}),
      h(View,{style:{flexDirection:'row',flexWrap:'wrap'}},...Object.entries({all:'전체',deleted:'삭제',edited:'수정',purged:'일괄 삭제',ghostpings:'고스트 핑',sent:'최근 메시지'}).map(([k,label])=>
        button(label,()=>{setKind(k);setLimit(archive?.options.renderCap||50);}))),
      h(View,{style:{flexDirection:'row',flexWrap:'wrap'}},
        button('기록 삭제',()=>RN.Alert.alert('기록 삭제','저장된 메시지와 수정 이력을 삭제할까요?',[
          {text:'취소',style:'cancel'},{text:'삭제',style:'destructive',onPress:()=>{archive?.clear();save();}}])),
        button('첨부 캐시 삭제',()=>RN.Alert.alert('첨부 캐시 삭제','기기에 저장한 첨부 캐시를 삭제할까요?',[
          {text:'취소',style:'cancel'},{text:'삭제',style:'destructive',onPress:()=>media?.clear().catch(error)}]))),
      text(logs.length+'개 · 첨부 캐시 '+((media?.used()||0)/1048576).toFixed(1)+' MiB',{marginVertical:10,color:'#b5bac1'}));
    const list=h(FlatList,{style:{flex:1,backgroundColor:'#313338'},contentContainerStyle:{padding:16,paddingBottom:40},
      data:archive?.options.streamMode?[]:logs.slice(0,limit),keyExtractor:r=>r.message.id,ListHeaderComponent:header,
      initialNumToRender:10,maxToRenderPerBatch:10,windowSize:5,
      ListEmptyComponent:text(started?'아직 기록 없음. 이 기기에서 본 메시지를 기록합니다.':'플러그인을 켜고 이 화면을 다시 여세요.'),
      ListFooterComponent:logs.length>limit?button('더 보기',()=>setLimit(n=>n+(archive?.options.renderCap||50))):null,
      renderItem:({item:r})=>h(Pressable,{onLongPress:()=>setAction({record:r}),style:{backgroundColor:'#2b2d31',padding:12,borderRadius:8,marginBottom:10}},
        text((r.deletedAt?(r.bulk?'일괄 삭제':'삭제됨'):r.history.length?'수정됨':'메시지')+(r.ghostPing?' · 고스트 핑':''),{color:r.deletedAt?'#ed4245':'#949ba4',fontWeight:'bold'}),
        text(r.message.author?.global_name||r.message.author?.username||r.message.author?.id||'알 수 없음',{fontWeight:'bold',marginTop:4}),
        text(archiveLocation(r.message),{color:'#b5bac1',fontSize:12,marginTop:4}),
        text('채널 '+r.message.channel_id+' · '+new Date(r.deletedAt||r.seenAt).toLocaleString(),{color:'#949ba4',fontSize:11}),
        ...verifiedEdits(archive,r.message.id).map((version)=>h(Pressable,{key:version.index,onLongPress:()=>setAction({record:r,editNum:version.index}),style:{marginTop:8,borderLeftWidth:2,borderLeftColor:'#949ba4',paddingLeft:8}},
          text('수정됨 · '+new Date(version.at).toLocaleString(),{color:'#949ba4',fontSize:11}),
          text(version.message.content||'(텍스트 없음)',{color:'#949ba4',opacity:0.7}))),
        text(r.message.content||'(텍스트 없음)',{color:r.deletedAt?'#ed4245':'#f2f3f5',marginTop:8}),
        ...(r.message.attachments||[]).map((a,i)=>h(Attachment,{key:a.id||i,attachment:a})),
        ...(r.message.embeds||[]).map((e,i)=>text([e.title,e.description,e.url].filter(Boolean).join('\n'),{color:'#b5bac1',marginTop:6}))) });
    return h(View,{style:{flex:1}},list,diagnosticOpen?h(RN.Modal,{visible:true,onRequestClose:()=>setDiagnosticOpen(false)},h(RN.ScrollView,{contentContainerStyle:{padding:20,backgroundColor:'#313338'}},button('닫기',()=>setDiagnosticOpen(false)),button('진단 복사',copyDiagnostic),text(diagnosticText,{fontSize:12,selectable:true}))):null,action&&UI?h(UI.Actions,{...action,onClose:()=>setAction(null)}):null);
  }
  const lifecycle={
    async start(){
      if(started)return;
      if(unpatches.length)await lifecycle.stop();
      React=api.react.React;RN=api.react.ReactNative;stores=api.discord.flux.Stores;
      if(!api.discord.flux.onFluxEventDispatched||!api.modules.native.fs?.writeFile)throw new Error('Revenge 플러그인 API 또는 네이티브 파일 모듈을 찾지 못했습니다.');
      const userId=stores.UserStore?.getCurrentUser?.()?.id;
      if(!/^\d+$/.test(userId||''))throw new Error('로그인 후 플러그인을 다시 켜세요.');
      base=api.jsonStorage.pluginStoragePathFor('com.local.message-logger','accounts/'+userId);
      journal=new Journal(api.modules.native.fs,base+'/archive',error);
      let data;try{data=await journal.read();}catch(e){try{data=JSON.parse(await api.modules.native.fs.readFile(base+'/backup.json'));if(data.accountId!==userId)throw e;}catch(_){throw e;}}
      try{const stored=JSON.parse(await api.modules.native.fs.readFile(base+'/settings.json'));data=stored.dontSaveData?{accountId:userId,records:[],options:stored}:{...data,options:stored};}catch(_){}
      archive=new Engine(data,userId,{selectedChannelId:stores.SelectedChannelStore?.getChannelId?.()||'',
        getChannel:id=>stores.ChannelStore?.getChannel?.(id),getUser:id=>stores.UserStore?.getUser?.(id),getGuild:id=>stores.GuildStore?.getGuild?.(id),
        getMember:(guild,id)=>stores.GuildMemberStore?.getMember?.(guild,id),getMessage:previous,
        isBlocked:id=>stores.RelationshipStore?.isBlocked?.(id),isGuildMuted:guild=>stores.UserGuildSettingsStore?.isMuted?.(guild),
        isChannelMuted:(guild,channel)=>stores.UserGuildSettingsStore?.isChannelMuted?.(guild,channel),channelReady:channel=>stores.MessageStore?.getMessages?.(channel)?.ready});
      temporaryRecords.clear();
      for(const r of data.localTemporaryRecords||[])if(r?.message?.id)temporaryRecords.set(r.message.id,r);
      for(const r of [...archive.records.values()])if(r.localTemporary||isLocalTemporary(r.message)){temporaryRecords.set(r.message.id,{...clone(r),localTemporary:true});archive.records.delete(r.message.id);save();}
      archive.context.getMessage=(channel,id)=>previous(id,channel);
      UI=createUI(api,()=>archive,save,refreshChat,backup,()=>({...diagnostics,stats:archive.stats()}));
      const nativeFile=api.discord.native?.FileModule;
      const binaryPath=(id,name)=>'message-logger/'+userId+'/'+id+'-'+String(name).replace(/[^a-zA-Z0-9._-]/g,'_');
      media=new MediaCache({fs:api.modules.native.fs,base:base+'/media',fetchData,settings:()=>({cacheMedia:archive.options.cacheAllImages,maxFileBytes:archive.options.maxFileBytes,maxMediaBytes:archive.options.maxMediaBytes}),
        writeBinary:typeof nativeFile?.writeFile==='function'?async(id,name,data)=>{const path=await nativeFile.writeFile('documents',binaryPath(id,name),data,'base64');return path.startsWith('file://')?path:'file://'+path;}:undefined,
        deleteBinary:typeof nativeFile?.removeFile==='function'?(id,name)=>nativeFile.removeFile('documents',binaryPath(id,name)):undefined,
        onChange:message=>{if(message)status=message;notify();}});
      await media.start();nativeSeen.clear();nativeRenderedSeen.clear();nativeRecordBefore.clear();temporaryIds.clear();nativeContentSeen.clear();nativePainted.clear();started=true;stopping=false;diagnostics={inline:'not found',prefetch:'not found',nativeRows:'탐색 대기',nativeBridge:'탐색 대기',flux:api.discord.flux.mode||'adapter',nativeTextShape:'아직 수집되지 않음',editEventsSeen:0,nativeRowsGenerated:0,nativeRecordUpdatesSeen:0,nativeBridgeCalls:0,nativeBridgeMessageRows:0,nativeBridgeStoreMatches:0,nativeBridgeHistoriesShown:0};status='기록 중 · MLV2 기본 필터 사용';
      try {
        patchRecordUpdates();
        patchNativeRows();
        patchNativeBridge();
        patchInline();
        patchActions();
        for(const type of ['MESSAGE_CREATE','MESSAGE_UPDATE','MESSAGE_DELETE','MESSAGE_DELETE_BULK','LOAD_MESSAGES_SUCCESS','CHANNEL_SELECT','CONNECTION_OPEN','MESSAGE_LOGGER_V2_SELF_TEST'])on(type,e=>{
          syncSelectedChannel();
          if(type==='MESSAGE_UPDATE')diagnostics.editEventsSeen++;
          const channel=e.channelId||e.channel_id||e.message?.channel_id||e.message?.channelId;
          if(e.message&&isLocalTemporary(e.message,e)){markTemporary(e.message.id);return e;}
          if(type==='MESSAGE_DELETE'&&temporaryMessage(e.id,channel)){
            markTemporary(e.id);diagnostics.temporaryDeletesPassed=(diagnostics.temporaryDeletesPassed||0)+1;return e;
          }
          const pending=type==='MESSAGE_DELETE_BULK'?(e.ids||[]).filter(id=>temporaryMessage(id,channel)):[];
          for(const id of pending)markTemporary(id);
          if(pending.length&&(e.ids||[]).length===pending.length)return e;
          if(type==='MESSAGE_CREATE'&&e.message?.id)temporaryIds.delete(e.message.id);
          const normalized=e.message?{...e,message:rawMessage(e)}:pending.length?{...e,ids:(e.ids||[]).filter(id=>!pending.includes(id))}:e;
          const priorRecord=archive.records.get(normalized.message?.id);
          const priorLength=priorRecord?.history.length||0;
          if(type==='MESSAGE_UPDATE'&&(e.__vml_restore_edit||e.message?.__vml_edits?.length||e.message?.edited_timestamp==='invalid_timestamp')){
            diagnostics.externalLoggerUpdatesIgnored=(diagnostics.externalLoggerUpdatesIgnored||0)+1;
            return e;
          }
          if(type==='LOAD_MESSAGES_SUCCESS')for(const raw of e.messages||[]){
            const record=archive.records.get(raw.id);if(!record?.history.length)continue;
            const loaded=normalizeMessage(raw,e.channelId||e.channel_id);
            if(!loaded||!('edited_timestamp' in raw||'editedTimestamp' in raw))continue;
            if(!validEditTime(loaded.edited_timestamp)){
              delete record.verifiedHistoryStart;delete record.editEvidence;delete record.editEvidenceSource;
            }
            save();
          }
          // Unverified legacy entries are preserved, but may not provide the
          // previous body for a newly confirmed edit.
          if(type==='MESSAGE_UPDATE'&&priorRecord&&(!Number.isInteger(priorRecord.verifiedHistoryStart)||!['event','native','record','bridge'].includes(priorRecord.editEvidenceSource))&&validEditTime(normalized.message?.edited_timestamp)){
            const live=nativeBaseline(normalized.message)||normalizeMessage(previous(normalized.message.id,normalized.message.channel_id),normalized.message.channel_id);
            if(typeof live?.content==='string')priorRecord.message.content=live.content;
          }
          if(type==='MESSAGE_UPDATE'&&validEditTime(normalized.message?.edited_timestamp)){
            const baseline=nativeBaseline(normalized.message);
            if(baseline&&baseline.content!==normalized.message.content&&archive.records.get(normalized.message.id)?.message.content!==normalized.message.content)
              archive.cache.set(normalized.message.id,clone(baseline));
          }
          const out=archive.process(normalized);
          if(type==='MESSAGE_UPDATE'&&validEditTime(normalized.message?.edited_timestamp)){
            const record=archive.records.get(normalized.message.id);
            if(record&&record.history.length>priorLength){
              if(!Number.isInteger(record.verifiedHistoryStart)||!['event','native','record','bridge'].includes(record.editEvidenceSource))record.verifiedHistoryStart=priorLength;
              record.editEvidence=normalized.message.edited_timestamp;record.editEvidenceSource='event';
              record.message.edited_timestamp=normalized.message.edited_timestamp;
              nativeRecordBefore.delete(normalized.message.id);
            }
          }
          effect(out.effects);
          if(out.event===null&&type!=='MESSAGE_LOGGER_V2_SELF_TEST'&&(!inlineReady||!archive.options.inlineEnabled||archive.options.streamMode))return e;
          if(out.event===null&&type!=='MESSAGE_LOGGER_V2_SELF_TEST')for(const id of (type==='MESSAGE_DELETE_BULK'?e.ids||[]:[e.id]))scheduleRefresh(id);
          if(type==='LOAD_MESSAGES_SUCCESS'&&out.event?.messages)out.event={...out.event,messages:out.event.messages.filter(m=>!archive.records.get(m.id)?.localTemporary&&!isLocalTemporary(m)).map(m=>archive.records.has(m.id)?localAttachments(m):m)};
          if(pending.length)return out.event===null?{...e,ids:pending}:e;
          return out.event;
        });
        maintenanceTimer=setInterval(()=>{const keep=archive.maintenance();save();if(archive.options.cacheAllImages&&!archive.options.dontDeleteCachedImages)media.prune(keep).catch(error);},300000);
        selfTestTimer=setInterval(()=>{try{api.discord.common?.flux?.Dispatcher?.dispatch?.({type:'MESSAGE_LOGGER_V2_SELF_TEST'});diagnostics.selfTest=Date.now()-lastTest<3000?'passed':'dispatcher unavailable';}catch(e){diagnostics.selfTest=e.message;}notify();},10000);
        if(RN.AppState?.addEventListener){const s=RN.AppState.addEventListener('change',state=>{if(state!=='active')flush().catch(error);});unpatches.push(()=>s.remove());}
        notify();
      }catch(e){await lifecycle.stop();throw e;}
    },
    async stop(){started=false;stopping=true;inlineReady=false;pendingRefresh.clear();for(const t of [maintenanceTimer,selfTestTimer,backupTimer])if(t)clearInterval(t);maintenanceTimer=selfTestTimer=backupTimer=null;for(const undo of unpatches.splice(0))try{undo();}catch(_){}
      media?.stop();await flush();status='기록 중지';notify();},
    SettingsComponent,
  };
  return definePlugin(lifecycle);
}
module.exports={createPlugin};

},
"./stable":function(module,exports,require){
'use strict';
const {createPlugin}=require('./plugin');
// API signatures checked against Revenge 1.11.6, commit 1b1d297.
function createStablePlugin(vd,host=globalThis){
  const common=vd.metro.common,patcher=vd.patcher;
  const nativeNames=['NativeFileModule','RTNFileManager','DCDFileManager'];
  let nativeFile;
  for(const name of nativeNames){
    try{nativeFile=host.__turboModuleProxy?.(name)||host.nativeModuleProxy?.[name]||common.ReactNative.NativeModules?.[name];}catch(_){}
    if(nativeFile)break;
  }
  const nativeFs={
    readFile:path=>nativeFile.readFile(nativeFile.getConstants().DocumentsDirPath+'/'+path,'utf8'),
    writeFile:(path,data)=>nativeFile.writeFile('documents',path,data,'utf8'),
    exists:path=>nativeFile.fileExists(nativeFile.getConstants().DocumentsDirPath+'/'+path),
    rm:path=>nativeFile.removeFile('documents',path),
  };
  const stores={};
  for(const name of ['UserStore','SelectedChannelStore','ChannelStore','MessageStore','GuildStore','GuildMemberStore','RelationshipStore','UserGuildSettingsStore'])stores[name]=vd.metro.findByStoreName(name);
  const channelMessages=vd.metro.findByProps('_channelMessages');
  const messageStore=stores.MessageStore;
  stores.MessageStore=Object.create(messageStore||null);
  stores.MessageStore.getMessage=(channel,id)=>{
    const existing=messageStore?.getMessage?.(channel,id);if(existing)return existing;
    const list=channelMessages?.get?.(channel)||channelMessages?._channelMessages?.[channel];
    return list?.get?.(id)||list?._map?.[id]||list?._array?.find(m=>m.id===id);
  };
  const handlers=new Map(),observed=new WeakSet();let dispatchUndo;
  function subscribe(type,cb){
    handlers.set(type,cb);
    // Discord can call a bound dispatch reference captured before our patch.
    // Its typed subscriptions still receive that action after the store update.
    const dispatcher=common.FluxDispatcher;
    const subscriber=event=>{
      if(observed.has(event)){observed.delete(event);return;}
      const handler=handlers.get(type);if(handler)handler(event);
    };
    const subscribed=typeof dispatcher.subscribe==='function'&&typeof dispatcher.unsubscribe==='function';
    if(subscribed)dispatcher.subscribe(type,subscriber);
    if(!dispatchUndo)dispatchUndo=patcher.instead('dispatch',common.FluxDispatcher,function(args,original){
      const event=args[0],handler=handlers.get(event?.type);
      if(!handler)return original.apply(this,args);
      const replacement=handler(event);
      if(replacement===null)return;
      if(subscribed&&replacement&&typeof replacement==='object')observed.add(replacement);
      return original.apply(this,[replacement,...args.slice(1)]);
    });
    return()=>{if(subscribed)dispatcher.unsubscribe(type,subscriber);handlers.delete(type);if(!handlers.size){dispatchUndo?.();dispatchUndo=undefined;}};
  }
  const finders={filters:{withProps:(...props)=>props},waitForModules(props,callback){
    let canceled=false,timer;
    function scan(){
      if(canceled)return;
      const mod=vd.metro.findByProps(...props);
      if(mod){callback(mod);return;}
      timer=setTimeout(scan,1000);
    }
    scan();return()=>{canceled=true;clearTimeout(timer);};
  }};
  function waitForNativeRows(callback,onStatus=()=>{}){
    let canceled=false,timer;
    function scan(){if(canceled)return;
      const rowModule=vd.metro.findByName?.('RowManager',false);
      const rows=rowModule?.default||rowModule?.RowManager||rowModule;
      onStatus(typeof rows?.prototype?.generate==='function'?'RowManager 발견 · 레코드 모듈 확인 중':'RowManager 탐색 중');
      const records=vd.metro.findByProps('createMessageRecord','updateMessageRecord');
      if(typeof rows?.prototype?.generate==='function'&&records){callback(rows.prototype,records);return;}
      timer=setTimeout(scan,1000);
    }
    scan();return()=>{canceled=true;clearTimeout(timer);};
  }
  function waitForNativeBridge(callback,onStatus=()=>{}){
    let canceled=false,timer,scans=0;const connected=new Set();
    function scan(){if(canceled)return;
      try{
        const named=common.ReactNative.NativeModules?.DCDChatManager;
        const all=vd.metro.findByPropsAll?.('updateRows')||[];
        const candidates=[named,...all.filter(m=>typeof m?.updateRows==='function'&&m.updateRows.toString().includes('[native code]'))];
        // A known chat-list controller is a fallback when the bridge is not
        // exported as a native function. No scan of unrelated function bodies.
        if(!candidates.some(m=>typeof m?.updateRows==='function'))candidates.push(vd.metro.findByProps('updateRows','clearRows','scrollToBottom'));
        for(const target of candidates)if(typeof target?.updateRows==='function'&&!connected.has(target)){
          connected.add(target);callback(target);
        }
        if(!connected.size)onStatus('updateRows 탐색 중');
      }catch(e){onStatus('updateRows 탐색 오류: '+String(e.message));}
      timer=setTimeout(scan,++scans<30?1000:30000);
    }
    scan();return()=>{canceled=true;clearTimeout(timer);};
  }
  async function jumpToMessage(message){
    const channelId=message?.channel_id,messageId=message?.id;
    if(!channelId||!messageId)throw Error('메시지 또는 채널 ID가 없습니다.');
    // The pinned Revenge URL polyfill exposes Discord's internal content-link
    // handler. Its openURL/openDeeplink aliases delegate to Android Linking,
    // so neither may be used here, including as an error fallback.
    const linking=common.url,handle=linking?.handleMessageLinking;
    if(typeof handle!=='function')throw Error('리벤지 내부 메시지 이동 기능을 찾지 못했습니다.');
    const guildId=message.guild_id||stores.ChannelStore?.getChannel?.(channelId)?.guild_id||'@me';
    return handle.call(linking,{guildId,channelId,messageId,navigationSettings:{navigationReplace:true}});
  }
  const api={clipboard:common.clipboard,pluginVersion:vd.plugin?.manifest?.version||'0.4.17',react:{React:common.React,ReactNative:common.ReactNative},
    discord:{flux:{Stores:stores,onFluxEventDispatched:subscribe,mode:typeof common.FluxDispatcher.subscribe==='function'?'dispatch + typed subscriptions':'dispatch'},common:{flux:{Dispatcher:common.FluxDispatcher}},native:{FileModule:nativeFile,waitForNativeRows,waitForNativeBridge},
      actions:{jumpToMessage,ToastActionCreators:{open:({content})=>vd.ui.toasts.showToast(content)}}},
    modules:{native:{fs:nativeFile?nativeFs:undefined},finders},
    patcher:{instead:(parent,key,cb)=>patcher.instead(key,parent,cb)},
    jsonStorage:{pluginStoragePathFor:(_id,path)=>'message-logger/'+path},
  };
  const lifecycle=createPlugin(api,x=>x);
  // The stable loader does not await onLoad/onUnload; queue transitions explicitly.
  let wanted=false,transition=Promise.resolve(),statusError;
  const report=error=>{statusError=String(error?.message||error);vd.logger?.error?.('[Message Logger] '+statusError);};
  function queue(fn){transition=transition.then(fn).catch(report);return transition;}
  function Status(){
    const React=common.React,RN=common.ReactNative;
    if(statusError)return React.createElement(RN.Text,{style:{color:'#ed4245',padding:16}},statusError);
    return React.createElement(lifecycle.SettingsComponent);
  }
  return {
    onLoad(){wanted=true;return queue(async()=>{if(wanted){statusError=undefined;await lifecycle.start();if(!wanted)await lifecycle.stop();}});},
    onUnload(){wanted=false;return queue(()=>lifecycle.stop());},
    settings:Status,
  };
}
module.exports={createStablePlugin};


},
"./mobile":function(module,exports,require){
'use strict';
const {snapshot}=require('./core');
function editTime(value){
  if(validEditTime(value))return value;
  if(!value||typeof value!=='object')return undefined;
  // MessageRecord date wrappers do not all expose toISOString. Only accept
  // explicit ISO serializers; do not infer an edit from the body or local time.
  for(const method of ['toISOString','toISO','toJSON'])try{
    if(typeof value[method]==='function'){
      const serialized=value[method]();if(validEditTime(serialized))return serialized;
    }
  }catch(_){}
  return undefined;
}
function normalizeMessage(raw,channelId,old,type){
  if(!raw)return null;
  const channel=raw.channel_id||raw.channelId||channelId;
  const out=snapshot(raw,channel);if(!out)return null;
  out.type=raw.type??old?.type??0;
  if(raw.state!==undefined)out.state=raw.state;
  const time=raw.edited_timestamp==='invalid_timestamp'?undefined:editTime(raw.edited_timestamp)||editTime(raw.editedTimestamp);
  if(time)out.edited_timestamp=time;
  if(out.edited_timestamp!=null&&!validEditTime(out.edited_timestamp))delete out.edited_timestamp;
  // Native aliases are accepted, but missing timestamps are never invented.
  // Content differences also occur in non-edit native refreshes.
  return out;
}
function isLocalTemporary(raw,event={}){
  if(!raw)return event.optimistic===true;
  if(event.optimistic===true||raw.optimistic===true)return true;
  if(['SENDING','SEND_FAILED','PENDING','SEND_PENDING','UPLOADING','FAILED'].includes(raw.state))return true;
  // A confirmed server message can retain its nonce. Do not reject all nonces.
  return raw.state!=='SENT'&&raw.nonce!=null&&String(raw.id)===String(raw.nonce);
}
function validEditTime(value){
  return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T/.test(value)&&Number.isFinite(Date.parse(value));
}
function verifiedEdits(archive,id){
  const r=archive.records.get(id);
  if(!r||!Number.isInteger(r.verifiedHistoryStart)||!['event','native','record','bridge'].includes(r.editEvidenceSource))return [];
  if(r.editsHidden||!archive.options.showEditedMessages||archive.options.streamMode)return [];
  const modifier=archive.modifiers.get(id)||{};
  const all=r.history.map((v,index)=>({...v,index})).filter(v=>v.index>=r.verifiedHistoryStart);
  if(modifier.editNum!=null)return all.filter(v=>v.index===modifier.editNum);
  const cap=archive.options.maxShownEdits;
  if(!cap||modifier.showAllEdits||all.length<=cap)return all;
  return archive.options.hideNewerEditsFirst?all.slice(0,cap):all.slice(-cap);
}
module.exports={normalizeMessage,validEditTime,editTime,verifiedEdits,isLocalTemporary};

}};const cache={};function require(id){if(!cache[id]){const m=cache[id]={exports:{}};modules[id](m,m.exports,require);}return cache[id].exports;}return require('./stable').createStablePlugin(vendetta);})()

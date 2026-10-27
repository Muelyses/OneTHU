import { useCallback, useEffect, useState } from 'react';
import { Btn, Card, Checkbox, Field, Inline, Input, Select, Stack, Text } from '@onethu/gui';
import type { TaskRecord, TaskRun } from '@onethu/sdk/tasks';
import { desktopTaskCall, listTaskChannels, subscribeDesktopTasks, readTaskInbox } from '../state/cliTasks.js';
import { learn } from '../lib/clients.js';
import { t, useLocale } from '../i18n/index.js';
import { useCliRuntime } from '../state/cliRuntime.js';

function runStatus(status: TaskRun['status']) {
  switch (status) {
    case 'running': return t('cli.tasks.status.running');
    case 'succeeded': return t('cli.tasks.status.succeeded');
    case 'partial': return t('cli.tasks.status.partial');
    case 'failed': return t('cli.tasks.status.failed');
    case 'cancelled': return t('cli.tasks.status.cancelled');
    case 'interrupted': return t('cli.tasks.status.interrupted');
  }
}

export function CliTasksSettings() {
  const locale=useLocale();
  const runtime=useCliRuntime();
  const [tasks,setTasks]=useState<TaskRecord[]>([]),[error,setError]=useState(''),[loading,setLoading]=useState(false);
  const [formLoading,setFormLoading]=useState(false);
  const [creating,setCreating]=useState(false),[busy,setBusy]=useState(''),[name,setName]=useState(''),[minutes,setMinutes]=useState('30'),[directory,setDirectory]=useState('');
  const [courses,setCourses]=useState<Array<{id:string;name:string}>>([]),[semester,setSemester]=useState(''),[selected,setSelected]=useState<string[]>([]);
  const [available,setAvailable]=useState<Array<{id:string;available?:boolean;label?:string}>>([]),[channels,setChannels]=useState<string[]>(['inbox']);
  const [editing,setEditing]=useState<TaskRecord|null>(null),[inbox,setInbox]=useState<Awaited<ReturnType<typeof readTaskInbox>>>([]),[inboxOpen,setInboxOpen]=useState(false);
  const [history,setHistory]=useState<{id:string;runs:TaskRun[]}|null>(null);
  const displayError=(value:unknown)=>{const code=/[A-Z][A-Z_]{3,}/.exec(String(value))?.[0];return `${t('cli.tasks.error')}${code?` · ${code}`:''}`;};
  const reload=useCallback(async()=>{setLoading(true);try{const [rows,messages]=await Promise.allSettled([desktopTaskCall({operation:'tasks.list',args:[]}),readTaskInbox()]);if(rows.status==='rejected')throw rows.reason;setTasks(rows.value as TaskRecord[]);if(messages.status==='fulfilled'){setInbox(messages.value);setError('');}else setError(displayError(messages.reason));}catch(e){setError(displayError(e));}finally{setLoading(false);}},[locale]);
  useEffect(()=>{void reload();const stop=subscribeDesktopTasks(()=>void reload());const timer=setInterval(()=>{if(document.visibilityState==='visible')void reload();},30000);return()=>{stop();clearInterval(timer);};},[reload]);
  async function openCreate(task?:TaskRecord){
    setEditing(task??null);setCreating(true);setError('');setFormLoading(true);
    setName(task?.name??'');setMinutes(String(task?.schedule.kind==='interval'?task.schedule.everyMinutes:30));
    setDirectory(task?.scope.outputDir??'');setChannels(task?.scope.channels??['inbox']);
    setSelected(task?.template.kind==='school-watch'?task.template.courseIds:[]);
    try{const semesterId=task?.template.kind==='school-watch'&&task.template.semesterId?task.template.semesterId:(await learn.getCurrentSemester()).id;
      setSemester(semesterId);const courseRows=await learn.getCourseList(semesterId);
      if(task?.template.kind==='school-watch')for(const id of task.template.courseIds)if(!courseRows.some(row=>row.id===id))courseRows.push({id,name:t('cli.tasks.unavailableCourse',{id})} as typeof courseRows[number]);
      setCourses(courseRows);
      const list=await listTaskChannels();setAvailable(list as typeof available);
    }catch(e){setError(displayError(e));}finally{setFormLoading(false);}
  }
  async function action(operation:string,id:string){
    setBusy(`${operation}:${id}`);setError('');
    try{const result=await desktopTaskCall({operation:`tasks.${operation}`,args:[id],confirm:true});if(operation==='history')setHistory({id,runs:result as TaskRun[]});await reload();}
    catch(e){setError(displayError(e));}finally{setBusy(value=>value===`${operation}:${id}`?'':value);}
  }
  async function create(){
    setBusy('create');setError('');
    try{const draft={name:name.trim()||t('cli.tasks.defaultName'),schedule:{kind:'interval',everyMinutes:Number(minutes)},template:{kind:'school-watch',courseIds:selected,semesterId:semester,channels,remindBeforeHours:editing?.template.kind==='school-watch'?editing.template.remindBeforeHours??[24,1]:[24,1],...(directory.trim()?{outputDir:directory.trim()}:{})}};await desktopTaskCall({operation:editing?'tasks.update':'tasks.create',confirm:true,args:editing?[editing.id,draft]:[draft]});setCreating(false);setEditing(null);setName('');setSelected([]);await reload();}
    catch(e){setError(displayError(e));}finally{setBusy('');}
  }
  const time=(value?:number|null)=>value?new Intl.DateTimeFormat(locale,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(value):'—';
  return <Stack gap={4} className="cli-task-manager">
    <Inline justify="between" wrap><Stack gap={1}><Text slot="subtitle" as="h3">{t('cli.tasks.title')}</Text><Text tone="quiet">{t('cli.tasks.description')}</Text></Stack><Btn variant="tonal" onClick={()=>void openCreate()} disabled={creating}>{t('cli.tasks.create')}</Btn></Inline>
    {error?<div role="alert"><Text tone="error">{error}</Text></div>:null}
    {/TASK_(?:MIGRATION|NOTIFICATION_BINDING)/.test(runtime.errorCode??'')?<div role="status"><Text tone="error">{t('cli.tasks.migrationPending')}</Text></div>:null}
    {creating?<Card pad="md" className="cli-task-form"><Stack gap={4}>
      <Text slot="subtitle">{editing?t('cli.tasks.edit'):t('cli.tasks.create')}</Text>
      <Field label={t('cli.tasks.name')}><Input value={name} onChange={setName} placeholder={t('cli.tasks.defaultName')} aria-label={t('cli.tasks.name')} maxLength={160}/></Field>
      <Field label={t('cli.tasks.interval')}><Select value={minutes} onChange={setMinutes} options={[...new Set([15,30,60,180,Number(minutes)])].sort((a,b)=>a-b).map(n=>({value:String(n),label:t('cli.tasks.minutes',{value:n})}))} aria-label={t('cli.tasks.interval')}/></Field>
      <Field label={t('cli.tasks.courses')}><Stack gap={2} className="cli-task-course-list">{courses.map(course=><Checkbox key={course.id} checked={selected.includes(course.id)} label={course.name} onChange={on=>setSelected(ids=>on?[...ids,course.id]:ids.filter(id=>id!==course.id))}/>)}</Stack></Field>
      <Field label={t('cli.tasks.directory')} hint={t('cli.tasks.directoryHint')}><Input value={directory} onChange={setDirectory} aria-label={t('cli.tasks.directory')}/></Field>
      <Field label={t('cli.tasks.channels')}><Inline wrap>{available.map(channel=><Checkbox key={channel.id} checked={channels.includes(channel.id)} disabled={channel.available===false} label={channel.id==='inbox'?t('cli.tasks.inbox'):channel.label??channel.id} onChange={on=>setChannels(ids=>on?[...ids,channel.id]:ids.filter(id=>id!==channel.id))}/>)}</Inline></Field>
      <Text tone="quiet">{t('cli.tasks.scope')}</Text>
      <Inline justify="end"><Btn onClick={()=>setCreating(false)} disabled={busy==='create'}>{t('common.cancel')}</Btn><Btn variant="solid" loading={busy==='create'} disabled={!selected.length||!channels.length||formLoading} onClick={()=>void create()}>{editing?t('cli.tasks.save'):t('cli.tasks.authorize')}</Btn></Inline>
    </Stack></Card>:null}
    {!tasks.length&&!creating?<Card pad="md"><Text tone="quiet">{loading?t('cli.tasks.loading'):t('cli.tasks.empty')}</Text></Card>:null}
    {tasks.map(task=><Card key={task.id} pad="md" className="cli-task-card"><Stack gap={3}>
      <Inline justify="between" wrap><Text weight="semibold">{task.name}</Text><Text tone="quiet">{task.enabled?t('cli.tasks.active'):t('cli.tasks.paused')}</Text></Inline>
      <Text tone="quiet">{task.enabled?t('cli.tasks.next',{value:time(task.nextRunAt)}):t('cli.tasks.pausedSchedule')}</Text>
      {task.scope.outputDir?<Text>{task.scope.outputDir}</Text>:null}
      {task.lastRun?<Text>{t('cli.tasks.result',{time:time(task.lastRun.finishedAt??task.lastRun.startedAt),status:runStatus(task.lastRun.status),downloads:task.lastRun.downloaded,notifications:task.lastRun.notified})}</Text>:null}
      <Inline wrap className="cli-task-actions">
        <Btn size="sm" variant="tonal" loading={busy===`run:${task.id}`||task.lastRun?.status==='running'} disabled={!task.enabled} onClick={()=>void action('run',task.id)}>{t('cli.tasks.run')}</Btn>
        <Btn size="sm" loading={busy===`${task.enabled?'pause':'resume'}:${task.id}`} onClick={()=>void action(task.enabled?'pause':'resume',task.id)}>{task.enabled?t('cli.tasks.pause'):t('cli.tasks.resume')}</Btn>
        <Btn size="sm" onClick={()=>void action('history',task.id)}>{t('cli.tasks.history')}</Btn>
        {task.template.kind==='school-watch'&&task.schedule.kind==='interval'?<Btn size="sm" disabled={creating} onClick={()=>void openCreate(task)}>{t('cli.tasks.edit')}</Btn>:null}
        <Btn size="sm" tone="error" onClick={()=>void action('remove',task.id)}>{t('cli.tasks.remove')}</Btn>
      </Inline>
      {history?.id===task.id?<Stack gap={3} className="cli-task-history">{history.runs.length?null:<Text tone="quiet">{t('cli.tasks.noHistory')}</Text>}{history.runs.slice().reverse().map(run=><div key={run.id} className="cli-task-history-item"><Text>{time(run.startedAt)} · {runStatus(run.status)}</Text>{run.changes.slice(0,8).map(change=><Text key={`${change.kind}:${change.id}`} tone="quiet">{change.title}</Text>)}{run.errors.map((code,i)=><Text key={`${i}:${code}`} tone="quiet">{code}</Text>)}</div>)}</Stack>:null}
    </Stack></Card>)}
    <div className="cli-task-inbox">
      <Btn variant="tonal" onClick={()=>setInboxOpen(value=>!value)} aria-expanded={inboxOpen}>{t('cli.tasks.inbox')} · {inbox.length}</Btn>
      {inboxOpen?<Stack gap={3} className="cli-task-inbox-list">{inbox.length?inbox.slice().reverse().map(message=><Card key={message.id} pad="md"><Stack gap={2}><Text slot="label" tone="quiet">{time(message.createdAt)}</Text><Text className="cli-task-message">{message.text}</Text></Stack></Card>):<Text tone="quiet">{t('cli.tasks.noMessages')}</Text>}</Stack>:null}
    </div>
    <Text slot="label" tone="quiet">{t('cli.tasks.resident')}</Text>
  </Stack>;
}

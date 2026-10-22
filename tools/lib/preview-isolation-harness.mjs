import React from '__REACT_URL__';
const { StrictMode, useEffect, useState } = React;
import Client from '/node_modules/.vite/deps/react-dom_client.js';
const { createRoot } = Client;
import { Ctx } from '/src/state/context.ts';
import { PreviewDataProvider } from '/src/components/PreviewData.tsx';
import * as data from '/src/state/data.ts';
import * as cache from '/src/state/cache.ts';
import { learn, info } from '/src/lib/clients.ts';
import { SearchPage } from '/src/pages/learn/SearchPage.tsx';
import { setLocale, t } from '/src/i18n/index.ts';
const h = React.createElement;
let revision = 1;
const course = () => ({id:'own-course',name:'自有课程 '+revision,englishName:'Owned course '+revision,courseNumber:'OWN',courseIndex:1,teacherName:'测试教师',timeAndLocation:[],url:''});
const homework = () => [{id:'own-hw',courseId:'own-course',title:'第一周 自有作业 '+revision,content:'',publishTime:'2026-10-20',deadline:'2026-10-25 23:59',submitted:false,graded:false,url:''}];
const files = () => [{id:'own-file',courseId:'own-course',title:'第一周 自有课件.pdf',uploadTime:'2026-10-20 10:00',downloadUrl:'',size:'1KB'}];
window.__fetches = 0; window.__broadcasts = 0;
learn.getCurrentSemester = async () => ({id:'own-semester'});
learn.getCourseList = async () => { window.__fetches++; return [course()]; };
learn.getAllHomework = async () => homework();
learn.getAllNotifications = async () => [];
learn.getFileList = async () => files();
window.__unexpected = [];
for (const key of ['getReport','getExams','getUserInfo','getLibBookRecords','getLibRoomRecords','getNews']) info[key] = async () => { window.__unexpected.push(key); throw Error('Unexpected request in preview'); };
const real = {courses:[course()],homework:homework(),files:files(),notifications:[],schedule:[],user:{name:'自有用户',studentId:'test-own'}};
const realCard = {info:{userName:'自有用户',balance:66},transactions:[]};
const semester = {firstDay:'2026-09-07',semesterId:'own-semester',weekCount:20,nextSemesterList:[]};
cache.cacheSet('campus', real, false);
cache.cacheSet('card:7', realCard, false);
cache.cacheSet('profile', real.user, false);
cache.cacheSet('report', [{name:'自有成绩',credit:1,grade:'A',point:4,semester:'own',raw:[]}], false);
cache.cacheSet('calendar', semester, false);
data.subscribeLearnData(() => window.__broadcasts++);
function Probe({id}) {
 const learnData = data.useLearnData(), campus = data.useCampusData(), card = data.useCard(7), profile = data.useProfile(), report = data.useReport(), calendar = data.useCalendar();
 const news = data.useNews(1), reservations = data.useTodayReservations(), deadlines = data.useTodayDeadlines(), today = data.useTodayCalendar(), feed = data.useTodayNewsFeed([]), sem = data.useSemesters(), week = data.useWeekSchedule(semester,1);
 useEffect(() => { if(id.startsWith('preview')) window.__reloadPreview = async () => { await Promise.all([learnData.reload(),campus.reload(),card.reload(),profile.reload(),report.reload(),calendar.reload(),news.reload(),reservations.reload(),deadlines.reload(),today.reload(),feed.reload(),sem.reload(),week.reload()]); }; });
 return h('div',{id},JSON.stringify({learn:learnData.data?.courses[0]?.name,campus:campus.data?.courses[0]?.name,card:card.data?.info.balance,profile:profile.data?.name,report:report.data?.[0]?.name}));
}
function App() {
 const [previews, setPreviews] = useState(false), [added,setAdded] = useState(false);
 window.__showPreviews = setPreviews; window.__addSearch = () => setAdded(true);
 return h(Ctx.Provider,{value:{status:'ready',navigate:()=>{},user:{name:'自有用户'}}},
  h('section',{id:'live'},h(SearchPage)),
  previews && h('section',{id:'preview-host'},h(PreviewDataProvider,null,h(Probe,{id:'preview-one'}),h(PreviewDataProvider,null,h(Probe,{id:'preview-two'})))),
  added && h('section',{id:'added'},h(SearchPage)));
}
window.__snapshot = () => ({learn:data.getLearnSnapshot(),campus:data.getCampusSnapshot(),profile:cache.cacheGet('profile'),keys:cache.cacheKeys(),persisted:JSON.stringify(localStorage)});
window.__baseline = null;
window.__refreshReal = async () => { revision=2; const profile={name:'更新后的自有用户',studentId:'test-own'};cache.cacheSet('profile',profile,true);await data.refreshLearnDataSilently();window.__updatedSnapshot=data.getLearnSnapshot(); };
window.__locale = setLocale;
window.__previewTitle = () => t("state.data.d4fa4ba858a6");
createRoot(document.getElementById('root')).render(h(StrictMode,null,h(App)));

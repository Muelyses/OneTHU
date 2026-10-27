import { VenueClient, getCourseXSemesters, searchCourseXPublic, getCourseXDetailPublic } from '@onethu/core';
import catalog from '../catalog.json';
import type { NodeSession } from '../node/session.js';
import type { ServiceOperation, OperationContext } from './types.js';

/** Direct adapters over the same clients as the graphical application. Every
 * submitted mutation receives a final account/consent/deadline guard. */
export function createSchoolServices(runtime: NodeSession): ServiceOperation[] {
  const { info, learn, helper, session } = runtime;
  const operations: ServiceOperation[] = [];
  const add = (name: string, permission: string, run: ServiceOperation['run'], authenticated = true) => {
    const def = catalog.find(op => op.name === name);
    if (!def) throw new Error(`CATALOG_ENTRY_MISSING:${name}`);
    operations.push({ ...def, permission, authenticated, run });
  };
  const bind = (prefix: string, target: any, names: Record<string,string>, permission: string, authenticated = true) => {
    for (const [name, method] of Object.entries(names)) add(`${prefix}.${name}`, permission, args => target[method](...args), authenticated);
  };
  add('session.status', 'user:read', () => runtime.status(), false);
  add('session.username', 'user:read', () => session.username || null);
  add('user.info', 'user:read', () => info.getUserInfo());
  bind('info', info, {
    schedule:'getSchedule', report:'getReport', exams:'getExams', deadlines:'getDeadlines', news:'getNews', newsDetail:'getNewsDetail',
    newsSub:'getNewsListBySubscription', searchNews:'searchNews', schoolCalendar:'getSchoolCalendar', classroomList:'getClassroomList',
    classroomState:'getClassroomState', invoices:'getInvoiceList', bankPayments:'getBankPayment', graduateIncome:'getGraduateIncome',
    dormScore:'getDormScore', physicalExam:'getPhysicalExamResult', assessmentList:'getAssessmentList',
  }, 'info:read');
  bind('card', info, {info:'getCardInfo',transactions:'getCardTransactions'}, 'card:read');
  bind('dorm', info, {eleRemainder:'getEleRemainder',elePayRecord:'getElePayRecord'}, 'dorm:read');
  bind('network', info, {balance:'getNetworkBalance',devices:'getOnlineDevices',deviceCount:'getNetworkDeviceCount',accountInfo:'getNetworkAccountInfo'}, 'network:read');
  bind('learn', learn, {semesters:'getSemesterIdList',bbsBoards:'getBbsBoards',bbsThread:'getBbsThread',bbsPosts:'getBbsThreadPosts'}, 'learn:read');
  add('learn.bbsThreads','learn:read', ([course, options = {}]) => learn.getBbsThreads(course, {bqid:'',kind:'yb',start:0,length:30,...options}));
  add('learn.reply','learn:write', ([course,thread,content],ctx) => learn.postBbsReply(course,thread,content,undefined,undefined,ctx.beforeWrite));
  add('learn.post','learn:write', ([course,bqid,title,html],ctx) => learn.postBbsThread(course,{bqid,title,html},ctx.beforeWrite));
  add('coursex.semesters','info:read', () => getCourseXSemesters(runtime.fetch), false);
  add('coursex.search','info:read', ([query,semester]) => searchCourseXPublic(runtime.fetch,query,semester), false);
  add('coursex.detail','info:read', ([id]) => getCourseXDetailPublic(runtime.fetch,id), false);
  bind('library', info, {list:'getLibraryList',sections:'getLibrarySectionList',seats:'getLibrarySeatList',records:'getLibBookRecords'}, 'library:read');
  add('library.floors','library:read', ([id,date = 0]) => info.getLibraryFloorList({id,zhName:'',zhNameTrace:'',valid:true},date));
  add('library.book','library:book', ([seat,section,date = 0],ctx) => info.bookLibrarySeat(seat,section,date,session.username,ctx.beforeWrite));
  add('library.cancel','library:book', ([id],ctx) => info.cancelLibBooking(id,session.username,ctx.beforeWrite));
  const readOnly = {readOnlyInitialization:true};
  add('libroom.list','library:read', () => info.getLibRoomInfoList(session.username,readOnly));
  add('libroom.resources','library:read', ([date,kind]) => info.getLibRoomResourceList(session.username,date,kind,readOnly));
  add('libroom.records','library:read', () => info.getLibRoomRecords(session.username,readOnly));
  add('libroom.fuzzyMember','library:read', ([keyword]) => info.fuzzySearchLibRoomMember(session.username,keyword,readOnly));
  add('libroom.book','library:book', ([room,start,end,members = []],ctx) => info.bookLibRoom(session.username,room,start,end,members,ctx.beforeWrite));
  add('libroom.cancel','library:book', ([id],ctx) => info.cancelLibRoomBooking(session.username,id,ctx.beforeWrite));
  add('kongjian.page','dorm:read', async ([options = {}]) => { const {fields:_fields,formAction:_action,...page} = await info.kongjianPage(options); return page; });
  add('kongjian.my','dorm:read', () => info.kongjianMy());
  add('kongjian.book','kongjian:book', ([url,details],ctx) => info.kongjianBook(url,details,ctx.beforeWrite));
  add('kongjian.cancel','kongjian:book', ([id],ctx) => info.kongjianCancel(id,ctx.beforeWrite));
  const venue = new VenueClient({fetch:runtime.fetch});
  let venueEpoch = -1;
  async function ensureVenue() {
    if (venueEpoch === runtime.epoch()) return;
    venue.setToken(null);
    const epoch = runtime.epoch();
    const cas = await venue.casAddress('https://www.sports.tsinghua.edu.cn/venue/index.html');
    const response = await runtime.http.request(cas, {redirect:'follow'});
    const page = `${response.headers.get('x-onethu-final-url') ?? ''}\n${await response.text()}`;
    runtime.assertCurrent(epoch);
    const ticket = /[?&]uniToken=([^&\s"'<>]+)/.exec(page)?.[1];
    if (!ticket) throw new Error('VENUE_AUTH_REQUIRED');
    const token = await venue.exchangeUniToken(decodeURIComponent(ticket));
    runtime.assertCurrent(epoch); venue.setToken(token); venueEpoch = epoch;
  }
  const withVenue = (fn:ServiceOperation['run']) => async (args:any[],ctx:OperationContext) => {await ensureVenue();return fn(args,ctx);};
  add('venue.scenes','venue:read', withVenue(() => venue.sceneList()));
  add('venue.currentPage','venue:read', withVenue(([params]) => venue.currentPage(params)));
  add('venue.myRecords','venue:read', withVenue(([page = 1]) => venue.myRecords(page,10)));
  add('venue.cancel','venue:book', withVenue(([id],ctx) => venue.cancelReserve(id,ctx.beforeWrite)));
  // The official venue booking flow remains a browser link, matching the app.
  add('venue.jump','venue:read', ([id]) => ({url:`https://www.sports.tsinghua.edu.cn/venue/index.html#/reserveList?uuid=${encodeURIComponent(id)}`}),false);
  bind('gitlab', helper, {
    projects:'getGitRecentProjects',starred:'getGitStarredProjects',search:'searchGitProjects',project:'getGitProjectDetail',branches:'getGitProjectBranches',tree:'getGitProjectTree',file:'getGitProjectFileBlob',
    issue:'getGitProjectIssue',issueNotes:'getGitIssueNotes',mergeRequest:'getGitProjectMergeRequest',mergeRequestNotes:'getGitMergeRequestNotes',jobs:'getGitPipelineJobs',jobTrace:'getGitJobTrace',
    discussions:'getGitDiscussions',awards:'getGitAwards',requestCounts:'getGitRequestCounts',mergeRequestChanges:'getGitMergeRequestChanges',
  },'gitlab:read');
  add('gitlab.issues','gitlab:read', ([id,opts = {}]) => helper.getGitProjectIssues(id,opts.state,opts.search,opts.page));
  add('gitlab.mergeRequests','gitlab:read', ([id,opts = {}]) => helper.getGitProjectMergeRequests(id,opts.state,opts.search,opts.page));
  add('gitlab.pipelines','gitlab:read', ([id,opts = {}]) => helper.getGitProjectPipelines(id,opts.ref,opts.page));
  add('gitlab.createIssue','gitlab:write', ([id,title,description],ctx) => helper.createGitProjectIssue(id,title,description,ctx.beforeWrite));
  add('gitlab.setState','gitlab:write', ([kind,id,iid,state],ctx) => kind === 'issue' ? helper.setGitIssueState(id,iid,state,ctx.beforeWrite) : helper.setGitMergeRequestState(id,iid,state,ctx.beforeWrite));
  add('gitlab.comment','gitlab:write', ([kind,id,iid,body],ctx) => kind === 'issue' ? helper.addGitIssueNote(id,iid,body,ctx.beforeWrite) : helper.addGitMergeRequestNote(id,iid,body,ctx.beforeWrite));
  add('gitlab.updateComment','gitlab:write', ([kind,id,iid,note,body],ctx) => kind === 'issue' ? helper.updateGitIssueNote(id,iid,note,body,ctx.beforeWrite) : helper.updateGitMergeRequestNote(id,iid,note,body,ctx.beforeWrite));
  add('gitlab.createMergeRequest','gitlab:write', ([id,source,target,title,description],ctx) => helper.createGitMergeRequest(id,source,target,title,description,ctx.beforeWrite));
  add('gitlab.mergeMergeRequest','gitlab:write', ([id,iid],ctx) => helper.mergeGitMergeRequest(id,iid,ctx.beforeWrite));
  add('gitlab.react','gitlab:write', ([kind,id,iid,name,note],ctx) => helper.addGitAward(kind,id,iid,name,note,ctx.beforeWrite));
  add('gitlab.unreact','gitlab:write', ([kind,id,iid,award,note],ctx) => helper.removeGitAward(kind,id,iid,award,note,ctx.beforeWrite));
  add('gitlab.reply','gitlab:write', ([kind,id,iid,discussion,body],ctx) => helper.addGitDiscussionNote(kind,id,iid,discussion,body,ctx.beforeWrite));
  add('gitlab.deleteComment','gitlab:write', ([kind,id,iid,discussion,note],ctx) => helper.deleteGitDiscussionNote(kind,id,iid,discussion,note,ctx.beforeWrite));
  add('gitlab.resolveDiscussion','gitlab:write', ([kind,id,iid,discussion,resolved],ctx) => helper.resolveGitDiscussion(kind,id,iid,discussion,resolved,ctx.beforeWrite));
  add('gitlab.assignees','gitlab:write', ([kind,id,iid,users],ctx) => helper.assignGitTo(kind,id,iid,users,ctx.beforeWrite));
  return operations;
}

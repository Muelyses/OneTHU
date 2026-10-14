/**
 * OneGUI 画廊（dev 自检）：组件 × 皮肤 × 明暗 × 密度的验收矩阵。
 *
 * 打开方式：dev 服务器加 ?onegui-gallery=1
 *   http://127.0.0.1:5180/?onegui-gallery=1
 * 用途：① 人眼验收基准；② headless 截图存档；③ 新组件必须在这里登记（护栏 G6）。
 * 它是开发工具，不是产品页面 —— 正式构建里整块被静态删除（import.meta.env.DEV）。
 *
 * 本文件本身就是"页面怎么写"的样板：只用 OneGUI 组件，零 class、零内联样式。
 */
import { useState, type ReactNode } from "react";
import {
  Badge, Btn, Card, Chip, Divider, EmptyState, Grid, Icon, IconBtn, Inline, KeyValue, List, Row,
  Section, Spacer, Stack, Surface, Tag, Text, useAxes, useOneGUI, type OGTheme,
} from "@onethu/gui";

const THEMES: OGTheme[] = [
  { id: "brand", name: "清华紫", accent: "#90399c" },
  { id: "blue", name: "湖蓝", accent: "#2f6fd0" },
  { id: "green", name: "松绿", accent: "#1f9d55" },
  { id: "amber", name: "琥珀", accent: "#c47a11" },
];

const SKIN_LEVELS = ["clear", "base", "rich", "deep"] as const;

function Group({ title, hint, children }: { title: string; hint?: string; children: ReactNode }): ReactNode {
  return (
    <Stack gap={3}>
      <Section title={title} hint={hint} />
      <Inline gap={2} wrap vAlign="center">
        {children}
      </Inline>
    </Stack>
  );
}

function AxisPicker<T extends string>({ label, values, value, onPick }: {
  label: string; values: readonly T[]; value: T; onPick: (v: T) => void;
}): ReactNode {
  return (
    <Inline gap={1}>
      <Text slot="label" tone="quiet">{label}</Text>
      {values.map((v) => (
        <Chip key={v} size="sm" selected={value === v} onClick={() => onPick(v)}>{v}</Chip>
      ))}
    </Inline>
  );
}

/** 组件目录：新组件必须在这里出现（护栏 G6 会核对导出与登记） */
function Catalog(): ReactNode {
  return (
    <Stack gap={7}>
      <Group title="Btn · 形态" hint="solid / tonal / outline / ghost / plain">
        <Btn variant="solid" tone="brand">主要操作</Btn>
        <Btn variant="tonal" tone="brand">次强调</Btn>
        <Btn variant="outline">描边</Btn>
        <Btn variant="ghost">幽灵</Btn>
        <Btn variant="plain">纯文字</Btn>
        <Btn variant="solid" tone="brand" loading>加载中</Btn>
        <Btn variant="solid" tone="brand" disabled>禁用</Btn>
      </Group>

      <Group title="Btn · 色调" hint="tone 只换色料，形态不动">
        <Btn variant="solid" tone="brand">brand</Btn>
        <Btn variant="solid" tone="error">error</Btn>
        <Btn variant="solid" tone="warning">warning</Btn>
        <Btn variant="solid" tone="success">success</Btn>
        <Btn variant="solid" tone="info">info</Btn>
        <Btn variant="tonal" tone="error">tonal error</Btn>
        <Btn variant="outline" tone="info">outline info</Btn>
      </Group>

      <Group title="Btn · 尺寸与图标" hint="sm / md / lg + 图标槽">
        <Btn size="sm" variant="outline">小</Btn>
        <Btn size="md" variant="outline">中</Btn>
        <Btn size="lg" variant="outline">大</Btn>
        <Btn variant="solid" tone="brand" icon={<Icon><path d="M12 5v14M5 12h14" /></Icon>}>新建</Btn>
        <IconBtn label="设置" variant="outline" icon={<Icon><circle cx="12" cy="12" r="3" /></Icon>} />
        <IconBtn label="刷新" round variant="tonal" tone="brand" icon={<Icon><path d="M20 12a8 8 0 1 1-2.34-5.66" /></Icon>} />
      </Group>

      <Group title="Text · 六档字阶" hint="display / title / subtitle / body / label / micro">
        <Stack gap={1}>
          <Text slot="display">显示 26</Text>
          <Text slot="title">标题 20</Text>
          <Text slot="subtitle">小标题 16</Text>
          <Text slot="body">正文 14 —— 每档一个语义位，不新增第六档。</Text>
          <Text slot="label">标签 12</Text>
          <Text slot="micro">微标 11</Text>
          <Inline gap={3} wrap>
            <Text tone="quiet">次文 content-2</Text>
            <Text tone="faint">弱文 content-3</Text>
            <Text tone="brand">强调色文字</Text>
            <Text tone="error">错误文字</Text>
            <Text tone="success">成功文字</Text>
            <Text mono>mono 1234.56</Text>
          </Inline>
        </Stack>
      </Group>

      <Group title="Chip / Tag / Badge">
        <Chip>默认胶囊</Chip>
        <Chip tone="brand">品牌</Chip>
        <Chip tone="error">错误</Chip>
        <Chip tone="success" selected>选中</Chip>
        <Chip onClick={() => undefined}>可点</Chip>
        <Chip onRemove={() => undefined}>可删</Chip>
        <Tag>标签</Tag>
        <Tag tone="info">info</Tag>
        <Badge count={3} standalone />
        <Badge dot standalone />
        <Badge count={12}>
          <IconBtn label="通知" variant="outline" icon={<Icon><path d="M6 8a6 6 0 0 1 12 0v5l2 3H4l2-3z" /></Icon>} />
        </Badge>
      </Group>

      <Stack gap={3}>
        <Section title="Surface / Card · 面阶" hint="level 0–3 / elevation / sunken 井" />
        <Grid min="sm">
          <Surface level={0} pad="md"><Text slot="label">level 0</Text></Surface>
          <Surface level={1} pad="md"><Text slot="label">level 1</Text></Surface>
          <Surface level={2} pad="md"><Text slot="label">level 2</Text></Surface>
          <Surface level={3} pad="md"><Text slot="label">level 3</Text></Surface>
          <Surface level={0} elevation={1} pad="md"><Text slot="label">elev 1</Text></Surface>
          <Surface level={0} elevation={2} pad="md"><Text slot="label">elev 2</Text></Surface>
          <Surface sunken pad="md"><Text slot="label">sunken 井</Text></Surface>
          <Surface level={0} pad="md" interactive selected><Text slot="label">selected</Text></Surface>
        </Grid>
      </Stack>

      <Grid min="md">
        <Card
          title="卡片标题"
          headAside={<Btn size="sm" variant="ghost">更多</Btn>}
          foot={<><Btn size="sm" variant="ghost">取消</Btn><Btn size="sm" variant="solid" tone="brand">确定</Btn></>}
        >
          <Text tone="quiet">卡片正文：面 + 圆角，描边只是 hairline，阴影克制。</Text>
        </Card>

        <Card flush>
          <List divided>
            <Row flush caret onClick={() => undefined} title="云盘文件" sub="2.4 MB · 今天" trailing="查看"
              leading={<Icon><circle cx="12" cy="12" r="9" /></Icon>} />
            <Row flush caret onClick={() => undefined} title="作业提交" sub="第 3 章习题" trailing={<Tag tone="warning">待交</Tag>}
              leading={<Icon><path d="M4 7h16v10H4z" /></Icon>} />
            <Row flush title="不可点的行" meta="meta" trailing="—" leading={<Icon><path d="M12 5v14M5 12h14" /></Icon>} />
          </List>
        </Card>

        <Card title="键值对">
          <KeyValue rows={[{ k: "学号", v: "2021••••" }, { k: "余额", v: "¥ 42.00" }, { k: "连接", v: "已连接" }]} />
        </Card>

        <Card title="空状态">
          <EmptyState
            icon={<Icon size="xl"><path d="M4 6h16v12H4z" /></Icon>}
            title="这里还什么都没有"
            hint="可以先从网络学堂同步一次。"
            action={<Btn variant="solid" tone="brand">去同步</Btn>}
          />
        </Card>

        <Card title="栅格与列表卡">
          <Grid min="sm">
            {["高数", "线代", "大物", "思修"].map((name) => (
              <Surface key={name} level={1} pad="md" interactive>
                <Stack gap={1}>
                  <Text slot="subtitle">{name}</Text>
                  <Text slot="label" tone="faint">课程</Text>
                </Stack>
              </Surface>
            ))}
          </Grid>
        </Card>

        <Card title="分隔线">
          <Stack gap={2}>
            <Text>上面</Text>
            <Divider />
            <Text>下面</Text>
            <Divider inset />
            <Text>缩进分隔线</Text>
            <Inline gap={2}>
              <Text>左</Text>
              <Divider vertical />
              <Text>右</Text>
            </Inline>
          </Stack>
        </Card>
      </Grid>
    </Stack>
  );
}

export function OneGUIGallery(): ReactNode {
  const axes = useAxes();
  const director = useOneGUI();
  const [themeIdx, setThemeIdx] = useState(0);

  return (
    <Stack gap={6} pad={6}>
      <Stack gap={2}>
        <Text slot="display">OneGUI 画廊</Text>
        <Text tone="quiet">
          六轴：皮肤 / 明暗 / 密度 / 动效 / 强调色 / 平台。下面是同一批组件在不同轴取值下的表现 ——
          组件本身零改动，改的全是管线里的令牌。
        </Text>
      </Stack>

      <Surface level={1} pad="md" sticky>
        <Stack gap={2}>
          <Inline gap={3} wrap>
            <AxisPicker label="皮肤" values={["neutral", "glass"] as const} value={axes.skin === "glass" ? "glass" : "neutral"} onPick={(v) => director.set({ skin: v })} />
            {axes.skin === "glass" ? (
              <AxisPicker label="浓淡" values={SKIN_LEVELS} value={axes.skinLevel as typeof SKIN_LEVELS[number]} onPick={(v) => director.set({ skinLevel: v })} />
            ) : null}
            <AxisPicker label="明暗" values={["auto", "light", "dark"] as const} value={axes.scheme} onPick={(v) => director.set({ scheme: v })} />
            <AxisPicker label="密度" values={["compact", "comfortable", "touch"] as const} value={axes.density} onPick={(v) => director.set({ density: v })} />
            <AxisPicker label="动效" values={["full", "reduced"] as const} value={axes.motion} onPick={(v) => director.set({ motion: v })} />
          </Inline>
          <Inline gap={1} wrap>
            <Text slot="label" tone="quiet">强调色</Text>
            {THEMES.map((t, i) => (
              <Chip key={t.id} size="sm" selected={themeIdx === i} onClick={() => { setThemeIdx(i); director.set({ theme: t }, { persist: false }); }}>
                {t.name}
              </Chip>
            ))}
            <Chip size="sm" selected={themeIdx === -1} onClick={() => { setThemeIdx(-1); director.set({ theme: null }, { persist: false }); }}>默认</Chip>
            <Spacer />
            <Text slot="micro" tone="faint">platform = {axes.platform}</Text>
          </Inline>
        </Stack>
      </Surface>

      <Catalog />
    </Stack>
  );
}

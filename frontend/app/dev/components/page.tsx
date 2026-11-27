"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Bell, FolderOpen, Heart, Mic, Plus, Search, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

import { Avatar } from "@/components/common/Avatar";
import { PixelSprite } from "@/components/common/PixelSprite";
import { Modal } from "@/components/common/Modal";
import { Drawer } from "@/components/common/Drawer";
import { EmptyState } from "@/components/common/EmptyState";
import { Panel } from "@/components/common/Panel";
import { toast } from "@/components/common/Toast";
import { ModeSwitcher } from "@/components/shell/ModeSwitcher";
import { PixelAvatar } from "@/components/home/PixelAvatar";

import { api } from "@/lib/mock";
import { useMockQuery } from "@/lib/hooks/useMockQuery";
import { AVATAR_LOOKS, COIN, HEART, HOUSE_ICON } from "@/lib/pixel/sprites";
import { useUI } from "@/stores/ui";
import type { Rarity } from "@/lib/types";
import { cn } from "@/lib/utils";

const SWATCHES = [
  "background", "card", "primary", "secondary", "muted", "accent", "destructive", "border",
  "success", "warning", "info", "status-online", "status-busy", "status-away",
  "rarity-common", "rarity-rare", "rarity-epic",
];

const RARITY_CLASS: Record<Rarity, string> = {
  common: "bg-rarity-common text-white",
  rare: "bg-rarity-rare text-white",
  epic: "bg-rarity-epic text-white",
};

export default function ComponentsShowcase() {
  const theme = useUI((s) => s.theme);
  const setTheme = useUI((s) => s.setTheme);
  const users = useMockQuery(() => api.auth.listUsers(), []);
  const [modal, setModal] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [progress, setProgress] = useState([62]);

  return (
    <div className="h-full overflow-y-auto scrollbar-thin">
      <div className="mx-auto max-w-6xl space-y-8 px-8 py-8">
        {/* header */}
        <div className="flex items-end justify-between gap-4">
          <div className="space-y-2">
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase home:font-pixel home:text-[8px]">
              Step 1 · Design system
            </p>
            <h1 className="text-2xl font-semibold tracking-tight home:text-base">Components</h1>
            <p className="text-sm text-muted-foreground">
              One token set, two modes, light and dark. Switch below or in the title bar.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <ModeSwitcher />
            <div className="flex items-center gap-2 text-sm">
              <Label htmlFor="dark">Dark</Label>
              <Switch
                id="dark"
                checked={theme === "dark"}
                onCheckedChange={(v) => setTheme(v ? "dark" : "light")}
              />
            </div>
          </div>
        </div>

        {/* tokens */}
        <Section title="Color tokens">
          <div className="grid grid-cols-6 gap-3">
            {SWATCHES.map((s) => (
              <div key={s} className="space-y-1.5">
                <div
                  className="h-12 border office:rounded-md home:pixel-border-flat home:m-1"
                  style={{ background: `var(--${s})` }}
                />
                <p className="truncate font-mono text-[11px] text-muted-foreground">--{s}</p>
              </div>
            ))}
          </div>
        </Section>

        {/* type */}
        <Section title="Typography">
          <div className="space-y-2">
            <h1 className="text-3xl font-semibold tracking-tight home:text-xl">Heading 1 — Your space</h1>
            <h2 className="text-xl font-semibold home:text-sm">Heading 2 — Rooms and people</h2>
            <h3 className="text-base font-semibold home:text-[11px]">Heading 3 — Details</h3>
            <p className="max-w-prose text-sm">
              Body text uses Inter in both modes for readability. Home mode swaps headings, buttons, and
              badges to <span className="font-pixel text-[10px]">Press Start 2P</span>.
            </p>
            <p className="text-xs text-muted-foreground">Muted caption text</p>
          </div>
        </Section>

        <div className="grid grid-cols-2 gap-6">
          {/* buttons */}
          <Section title="Buttons">
            <div className="flex flex-wrap items-center gap-2">
              <Button>Primary</Button>
              <Button variant="secondary">Secondary</Button>
              <Button variant="outline">Outline</Button>
              <Button variant="ghost">Ghost</Button>
              <Button variant="destructive">Leave</Button>
              <Button variant="link">Link</Button>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button size="sm"><Plus /> Small</Button>
              <Button size="lg"><Sparkles /> Large</Button>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button size="icon" variant="outline" aria-label="Mute"><Mic /></Button>
                </TooltipTrigger>
                <TooltipContent>Mute (⌘D)</TooltipContent>
              </Tooltip>
              <Button disabled>Disabled</Button>
            </div>
          </Section>

          {/* form */}
          <Section title="Form controls">
            <div className="grid gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="search">Search</Label>
                <div className="relative">
                  <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground home:left-4" />
                  <Input id="search" placeholder="Find rooms, people, files…" className="pl-8 home:pl-9" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Select defaultValue="rare">
                  <SelectTrigger className="w-full"><SelectValue placeholder="Rarity" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="common">Common</SelectItem>
                    <SelectItem value="rare">Rare</SelectItem>
                    <SelectItem value="epic">Epic</SelectItem>
                  </SelectContent>
                </Select>
                <div className="flex items-center gap-2 text-sm">
                  <Switch id="n" defaultChecked /> <Label htmlFor="n">Notifications</Label>
                </div>
              </div>
              <Slider value={progress} onValueChange={setProgress} max={100} step={1} />
            </div>
          </Section>
        </div>

        <div className="grid grid-cols-2 gap-6">
          <Section title="Badges & progress">
            <div className="flex flex-wrap gap-2">
              <Badge>Default</Badge>
              <Badge variant="secondary">Secondary</Badge>
              <Badge variant="outline">Outline</Badge>
              {(["common", "rare", "epic"] as Rarity[]).map((r) => (
                <Badge key={r} className={cn("capitalize", RARITY_CLASS[r])}>{r}</Badge>
              ))}
              <Badge className="bg-warning text-black">For sale</Badge>
            </div>
            <div className="mt-4 space-y-1.5">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Trip to Kyoto</span>
                <span>{progress[0]}%</span>
              </div>
              <Progress value={progress[0]} />
            </div>
          </Section>

          <Section title="Tabs">
            <Tabs defaultValue="grid">
              <TabsList>
                <TabsTrigger value="grid">Grid</TabsTrigger>
                <TabsTrigger value="list">List</TabsTrigger>
                <TabsTrigger value="recent">Recent</TabsTrigger>
              </TabsList>
              <TabsContent value="grid" className="pt-2 text-sm text-muted-foreground">Grid view content.</TabsContent>
              <TabsContent value="list" className="pt-2 text-sm text-muted-foreground">List view content.</TabsContent>
              <TabsContent value="recent" className="pt-2 text-sm text-muted-foreground">Recent files.</TabsContent>
            </Tabs>
          </Section>
        </div>

        {/* avatars */}
        <Section title="Avatar (with status dot) — loaded via mock API">
          {users.loading ? (
            <div className="flex gap-3">
              {Array.from({ length: 9 }).map((_, i) => (
                <div key={i} className="size-10 animate-pulse bg-muted office:rounded-full" />
              ))}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                {users.data?.map((u, i) => (
                  <Avatar key={u.id} user={u} size="md" ring={i === 1} />
                ))}
              </div>
              <div className="flex items-end gap-3">
                {(["xs", "sm", "md", "lg", "xl"] as const).map((s) => (
                  <Avatar key={s} user={users.data![0]} size={s} />
                ))}
              </div>
            </div>
          )}
        </Section>

        {/* pixel */}
        <Section title="PixelAvatar & sprites">
          <div className="flex flex-wrap items-end gap-8 bg-muted/60 p-6 office:rounded-lg">
            <PixelAvatar userId="u1" name="Alex" showName status="online" />
            <PixelAvatar userId="u9" name="Sam" showName status="away" flip speaking />
            {Object.entries(AVATAR_LOOKS).map(([k, look]) => (
              <PixelAvatar key={k} userId={k} look={look} name={k} showName scale={3} />
            ))}
            <div className="flex items-end gap-4">
              <PixelSprite sprite={HEART} scale={5} title="heart" />
              <PixelSprite sprite={COIN} scale={4} title="coin" />
              <PixelSprite sprite={HOUSE_ICON} scale={5} title="house" />
            </div>
          </div>
        </Section>

        {/* overlays */}
        <div className="grid grid-cols-3 gap-6">
          <Section title="Modal">
            <Button onClick={() => setModal(true)}>Open modal</Button>
          </Section>
          <Section title="Drawer">
            <Button variant="secondary" onClick={() => setDrawer(true)}>Open drawer</Button>
          </Section>
          <Section title="Toast">
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => toast.success("Saved your layout")}>Success</Button>
              <Button variant="outline" onClick={() => toast.error("Couldn't join the room")}>Error</Button>
              <Button
                variant="outline"
                onClick={() =>
                  toast.promise(new Promise((r) => setTimeout(r, 1200)), {
                    loading: "Waiting for Sam to approve…",
                    success: "Approved by both partners",
                  })
                }
              >
                Async
              </Button>
            </div>
          </Section>
        </div>

        <div className="grid grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Card</CardTitle>
              <CardDescription>shadcn Card, skinned per mode via data-slot.</CardDescription>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Office cards are compact with soft borders. Home cards get a stepped 4px pixel frame and drop shadow.
            </CardContent>
          </Card>
          <Panel>
            <EmptyState
              icon={FolderOpen}
              title="No files yet"
              description="Upload something to share it with your team."
              action={<Button size="sm"><Plus /> Upload</Button>}
            />
          </Panel>
        </div>

        <Panel inset className="flex items-center gap-4">
          <motion.div
            animate={{ rotate: [0, -12, 12, 0] }}
            transition={{ duration: 1.4, repeat: Infinity, repeatDelay: 2 }}
          >
            <Bell className="size-5 text-primary" />
          </motion.div>
          <p className="text-sm">
            Framer Motion is wired up (mode pill uses a shared <code className="font-mono">layoutId</code>).
          </p>
        </Panel>
      </div>

      <Modal
        open={modal}
        onOpenChange={setModal}
        title="List for sale"
        description="Set a price in USDC. Your partner will be notified."
        footer={
          <>
            <Button variant="ghost" onClick={() => setModal(false)}>Cancel</Button>
            <Button onClick={() => { setModal(false); toast.success("Listed for 18 USDC"); }}>List item</Button>
          </>
        }
      >
        <div className="grid gap-1.5">
          <Label htmlFor="price">Price (USDC)</Label>
          <Input id="price" type="number" defaultValue={18} min={1} />
        </div>
      </Modal>

      <Drawer open={drawer} onOpenChange={setDrawer} title="Chat" description="Couple chat">
        <EmptyState icon={Heart} title="Say hi to Sam" description="Messages appear here during movie night." />
      </Drawer>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-muted-foreground home:text-[10px]">{title}</h2>
      {children}
    </section>
  );
}

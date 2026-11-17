import re, json, sys
SRC=sys.argv[1] if len(sys.argv)>1 else '/home/claude/extendo/public/ningen/index.html'
s=open(SRC).read(); base=s.index('<script>'); js=s[base:]
marks=[(m.start(),m.group(1)) for m in re.finditer(r'/\* ========= (.+?) ========= \*/',js)]
CH={'DATA':'第1章','STATE':'共通','AUDIO':'共通','UI HELPERS':'共通','DOCK':'共通UI','NOTEBOOK':'共通UI','ACTIONS':'第1章','EVENTS':'第1章','CHAPTER 2 DATA':'第2章','SCENES':'第4〜5章','CHAPTER 2':'第2章','CHAPTER 3':'第3章','CHAPTER 4':'第4章','CHAPTER 5':'第5章','ENDINGS':'エンディング','TUTORIAL (SESSION 00)':'研修','FLOW':'第1章'}
def section(pos):
    cur='共通'
    for p,n in marks:
        if p<=pos: cur=n
    return CH.get(cur,cur)
TOK=[(r'ritsu\(','律'),(r'\bme\(','検査官'),(r'\bsys\(','システム'),(r'lines:\[','律'),(r'label:','選択肢'),(r'\b[123]:\[','律（指摘への反応）'),
     (r'WRONG = \[','律（外れたとき）'),(r'short:','証言（手帳）'),(r'ev:','指摘の台詞'),(r'line:\(','指摘の台詞'),(r'title:','記録の見出し'),(r'rows:\[','書類'),(r'docCard\(','書類'),
     (r'memoCard\(','カード'),(r'photoCard\(','写真'),(r'scene\(','場面説明'),(r'chapterCard\(','章タイトル'),(r'showEnding\(','エンディング文'),(r'choiceList\(','選択肢'),
     (r'dockChoice\(','選択肢'),(r'tutPick\(','選択肢'),(r'tutDock\(','案内'),(r'header\(','案内'),(r'why:','記録の補足'),(r'lockText:','システム'),(r'note:','書類'),(r'desc:','説明'),
     (r'name:','選択肢'),(r"\['c2\d'|H = |HINTS2 = \[",'ヒント'),(r'last=','律'),(r'style=','結果画面'),(r'desc=','結果画面'),(r'innerHTML','UI')]
PAT=re.compile(r"(['`])((?:\\.|(?!\1).)*?)\1", re.S)
rows=[]
for m in PAT.finditer(js):
    txt=m.group(2)
    if not re.search(r'[ぁ-んァ-ヶ一-龠]', txt): continue
    if '<div' in txt or 'class=' in txt or len(txt)>400: continue
    pos=m.start(); pre=js[max(0,pos-700):pos]
    best=(-1,'その他')
    for t,lab in TOK:
        for mm in re.finditer(t,pre):
            if mm.start()>best[0]: best=(mm.start(),lab)
    who=best[1]; sec=section(pos)
    if sec=='研修' and who.startswith('律'): who='サトウ'
    rows.append({'pos':pos+base,'start':m.start(2)+base,'end':m.end(2)+base,'ch':sec,'who':who,'text':txt})
for i,r in enumerate(rows): r['id']=f'T{i+1:03d}'
json.dump(rows,open(sys.argv[2] if len(sys.argv)>2 else 'lines.json','w'),ensure_ascii=False,indent=0)
if __name__=='__main__':
    from collections import Counter
    print(len(rows)); print(Counter(r['who'] for r in rows).most_common())

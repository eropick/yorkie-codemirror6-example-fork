/* yorkie, codemirror */
import yorkie, { OperationInfo } from 'yorkie-js-sdk';
import { basicSetup, EditorView } from 'codemirror';
import { keymap } from '@codemirror/view';
import {
  markdown,
  markdownKeymap,
  markdownLanguage,
} from '@codemirror/lang-markdown';
import { Transaction } from '@codemirror/state';

const editorParentElem = document.getElementById('editor'); //편집기

async function main() {
  //yorkie API client
  const client = new yorkie.Client('https://api.yorkie.dev', {
    apiKey: 'xxxxxxxxxxxxxxxxxxxxxxxxxxxx', //your YorkieAPI key
  });
  await client.activate();

  //document 생성 후 client -> attach
  const doc = new yorkie.Document("editor");
  await client.attach(doc);

  doc.update((root) => {
    if (!root.content) {
      root.content = new yorkie.Text();
    }
  }, 'create content if not exists');
  
  //yorkie에 존재하는 content를 codemirror에 dispatch하는 함수
  //content of yorkie yorkie -> dispatch -> CodeMirror Editor 
  const syncText = () => {
    const text = doc.getRoot().content;
    editor.dispatch({
      changes: { from: 0, to: editor.state.doc.length, insert: text.toString() },
      annotations: [Transaction.remote.of(true)],
    });
  };

  //Text의 경우 DB snapshot이 찍힐 때 재동기화 해줘야 한다.
  doc.subscribe((event) => {
    if (event.type === 'snapshot') { 
      syncText();
    }
  });

  //yorkie의 content 구독 이벤트
  doc.subscribe('$.content', (event) => {
    if (event.type === 'remote-change') {
      const { operations } = event.value;
      handleOperations(operations);
    }
  });

  await client.sync();

  //codeMirror에서 수정한 내용을 Yorkie로 옮길 때 사용하는 이벤트 처리 핸들러
  //codeMirror To Yorkie handle
  const updateListener = EditorView.updateListener.of((viewUpdate) => {
    if (viewUpdate.docChanged) {
      for (const tr of viewUpdate.transactions) {
        const events = ['select', 'input', 'delete', 'move', 'undo', 'redo'];
        if (!events.map((event) => tr.isUserEvent(event)).some(Boolean)) {
          continue;
        }
        if (tr.annotation(Transaction.remote)) {
          continue;
        }
        let adj = 0;
        tr.changes.iterChanges((fromA, toA, _, __, inserted) => {
          const insertText = inserted.toJSON().join('\n');
          doc.update((root) => {
            root.content.edit(fromA + adj, toA + adj, insertText);
          }, `update content byA ${client.getID()}`);
          adj += insertText.length - (toA - fromA);
        });
      }
    }
  });

  //CodeMirror 편집기 생성
  const editor = new EditorView({
    doc: '',
    extensions: [
      basicSetup,
      markdown({ base: markdownLanguage }),
      keymap.of(markdownKeymap),
      updateListener,
    ],
    parent: editorParentElem,
  });

  //Yorkie에서 CodeMirror로 변경 값 보낼 때 사용하는 핸들러
  //Yorkie To CodeMirror Handle
  function handleOperations(operations) {
    operations.forEach((op) => {
      if (op.type === 'edit') {
        handleEditOp(op);
      }
    });
  }
  function handleEditOp(op) { //연산 종류에 따라 수행
    const changes = [
      {
        from: Math.max(0, op.from),
        to: Math.max(0, op.to),
        insert: op.value.content,
      },
    ];
    editor.dispatch({ //변경사항 적용
      changes,
      annotations: [Transaction.remote.of(true)],
    });
  }
  syncText();
}
main();
import { useCallback, useMemo } from 'react';
import { Descendant, Element, Node, Path, Text } from 'slate';
import produce from 'immer';
import { ElementType } from 'types/slate';
import { Note } from 'types/supabase';
import useNotes from 'lib/api/useNotes';
import supabase from 'lib/supabase';
import { useAuth } from 'utils/useAuth';

type Backlink = {
  id: string;
  title: string;
  matches: Array<{
    context: string;
    path: Path;
  }>;
};

export default function useBacklinks(noteId: string) {
  const { user } = useAuth();
  const { data: notes = [] } = useNotes();
  const backlinks = useMemo(() => getBacklinks(notes, noteId), [notes, noteId]);

  const updateBacklinks = useCallback(
    async (newTitle: string) => {
      if (!user) {
        return;
      }

      const upsertData = [];
      for (const backlink of backlinks) {
        const backlinkContent = notes.find((note) => note.id === backlink.id)
          ?.content;

        if (!backlinkContent) {
          console.error(`No backlink content found for note ${backlink.id}`);
          continue;
        }

        let newBacklinkContent = backlinkContent;
        for (const match of backlink.matches) {
          newBacklinkContent = produce(newBacklinkContent, (draftState) => {
            // Path should not be empty
            const path = match.path;
            if (path.length <= 0) {
              return;
            }

            // Get the node from the path
            let linkNode = draftState[path[0]];
            for (const pathNumber of path.slice(1)) {
              linkNode = (linkNode as Element).children[pathNumber];
            }

            // Assert that linkNode is a note link
            if (
              !Element.isElement(linkNode) ||
              linkNode.type !== ElementType.NoteLink
            ) {
              return;
            }

            // Update noteTitle property on the node
            linkNode.noteTitle = newTitle;

            // If isTextTitle is true, then the link text should always be equal to the note title
            if (linkNode.isTextTitle) {
              for (const linkNodeChild of linkNode.children) {
                linkNodeChild.text = newTitle;
              }
            }
          });
        }
        upsertData.push({
          id: backlink.id,
          title: backlink.title,
          user_id: user.id,
          content: newBacklinkContent,
        });
      }

      // Update in database
      await supabase.from<Note>('notes').upsert(upsertData);
    },
    [user, notes, backlinks]
  );

  return { backlinks, updateBacklinks };
}

/**
 * Searches the notes array for note links to the given noteId
 * and returns an array of the matches.
 */
const getBacklinks = (notes: Note[], noteId: string): Backlink[] => {
  const result: Backlink[] = [];
  for (const note of notes) {
    const matches = getBacklinkMatches(note.content, noteId);
    if (matches.length > 0) {
      result.push({
        id: note.id,
        title: note.title,
        matches,
      });
    }
  }
  return result;
};

const getBacklinkMatches = (nodes: Descendant[], noteId: string) => {
  const result: Backlink['matches'] = [];
  for (const [index, node] of nodes.entries()) {
    result.push(...getBacklinkMatchesHelper(node, noteId, [index]));
  }
  return result;
};

const getBacklinkMatchesHelper = (
  node: Descendant,
  noteId: string,
  path: Path
): Backlink['matches'] => {
  if (Text.isText(node)) {
    return [];
  }

  const result: Backlink['matches'] = [];
  const children = node.children;
  for (const [index, child] of children.entries()) {
    if (Element.isElement(child)) {
      if (
        child.type === ElementType.NoteLink &&
        child.noteId === noteId &&
        Node.string(child)
      ) {
        result.push({
          context: Node.string(node),
          path: [...path, index],
        });
      }
      result.push(...getBacklinkMatchesHelper(child, noteId, [...path, index]));
    }
  }

  return result;
};

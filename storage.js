const SUPABASE_URL = 'https://nbrnfelktphyvjwuftyz.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_sIXWB7J3YfbchA666wgNZA_LSBzqHb2';
const supabaseClient = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY
);

async function signIn(email, password) {
  const { data, error } = await supabaseClient.auth.signInWithPassword({
    email,
    password
  });

  if (error) throw error;
  return data;
}

async function signOut() {
  const { error } = await supabaseClient.auth.signOut();
  if (error) throw error;
}

async function getCurrentUser() {
  const { data, error } = await supabaseClient.auth.getUser();

  if (error) return null;
  return data.user || null;
}


/* =========================================================
   MuseumStore
   - 기존 app.js와의 연결 방식은 그대로 유지합니다.
   - 실제 저장 장소만 IndexedDB → Supabase로 변경합니다.
   ========================================================= */

window.MuseumStore = (() => {

  const CURRENT_ROOM_KEY = 'memory-museum-current-room';


  /* 현재 로그인한 선생님 확인 */
  async function requireUser() {
    const user = await getCurrentUser();

    if (!user) {
      throw new Error('로그인이 필요합니다.');
    }

    return user;
  }


  /* ---------------------------------------------------------
     전시관 하나 읽기
     --------------------------------------------------------- */
  async function room(id) {
    const user = await requireUser();

     data: exhibition, error: exhibitionError } =
      await supabaseClient
        .from('exhibitions')
        .select('*')
        .eq('id', id)
        .eq('owner_id', user.id)
        .single();

    if (exhibitionError) {
      if (exhibitionError.code === 'PGRST116') {
        return null;
      }

      throw exhibitionError;
    }


     data: works, error: worksError } =
      await supabaseClient
        .from('works')
        .select('*')
        .eq('exhibition_id', id)
        .order('slot');

    if (worksError) {
      throw worksError;
    }


    /*
      Supabase Storage는 현재 private bucket이므로
      작품 이미지를 blob으로 다시 받아옵니다.
    */
    const loadedWorks = await Promise.all(
      works.map(async work => {

         data: blob, error } =
          await supabaseClient
            .storage
            .from('works')
            .download(work.image_path);

        if (error) {
          throw error;
        }

        return {
          id: work.id,
          slot: work.slot,
          name: work.name,
          title: work.title,
          description: work.description,
          imagePath: work.image_path,
          width: work.width,
          height: work.height,
          blob
        };
      })
    );


    const settings = exhibition.settings || {};

    const count =
      Number(settings.count) ||
      loadedWorks.length ||
      0;


    const state = {
      id: exhibition.id,
      version: 2,
      settings: {
        ...settings,
        title: exhibition.title,
        theme: exhibition.theme,
        count
      },
      works: Array(count).fill(null)
    };


    loadedWorks.forEach(work => {
      if (
        Number.isInteger(work.slot) &&
        work.slot >= 0 &&
        work.slot < state.works.length
      ) {
        state.works[work.slot] = work;
      }
    });


    localStorage.setItem(CURRENT_ROOM_KEY, exhibition.id);

    return state;
  }


  /* ---------------------------------------------------------
     현재 전시관 읽기
     --------------------------------------------------------- */
  async function read() {

    const user = await requireUser();

    const currentId =
      localStorage.getItem(CURRENT_ROOM_KEY);


    /*
      마지막으로 열었던 전시관이 있다면
      그것을 먼저 불러옵니다.
    */
    if (currentId) {
      const current = await room(currentId);

      if (current) {
        return current;
      }
    }


    /*
      마지막 전시관 정보가 없으면
      가장 최근에 수정된 전시관을 불러옵니다.
    */
     data, error } =
      await supabaseClient
        .from('exhibitions')
        .select('*')
        .eq('owner_id', user.id)
        .order('updated_at', { ascending: false })
        .limit(1);

    if (error) {
      throw error;
    }

    if (!data || data.length === 0) {
      return null;
    }

    return await room(data[0].id);
  }


  /* ---------------------------------------------------------
     전시관 저장
     --------------------------------------------------------- */
  async function write(value) {

    const user = await requireUser();


    if (!value.id) {
      value.id = crypto.randomUUID();
    }


    /*
      1. 전시관 기본 정보 저장
    */
  const { error: exhibitionError } =
  await supabaseClient
    .from('exhibitions')
    .upsert({
      id: value.id,
      owner_id: user.id,
      title: value.settings?.title || '',
      theme: value.settings?.theme || '',
      settings: value.settings || {},
      share_token: value.shareToken || crypto.randomUUID(),
      updated_at: new Date().toISOString()
    });
    
    if (exhibitionError) {
      throw exhibitionError;
    }


    /*
      2. 현재 작품 목록 확인
    */
    const { data: existingWorks, error: existingError } =
      await supabaseClient
        .from('works')
        .select('id, image_path')
        .eq('exhibition_id', value.id);

    if (existingError) {
      throw existingError;
    }


    const currentWorks =
      (value.works || []).filter(Boolean);


    const currentIds =
      new Set(currentWorks.map(work => work.id));


    /*
      3. 삭제된 작품 처리
    */
    const removedWorks =
      (existingWorks || []).filter(
        work => !currentIds.has(work.id)
      );


    if (removedWorks.length > 0) {

      const paths =
        removedWorks
          .map(work => work.image_path)
          .filter(Boolean);


      if (paths.length > 0) {
        const { error: storageError } =
          await supabaseClient
            .storage
            .from('works')
            .remove(paths);

        if (storageError) {
          throw storageError;
        }
      }


      const removedIds =
        removedWorks.map(work => work.id);


      const { error: deleteError } =
        await supabaseClient
          .from('works')
          .delete()
          .in('id', removedIds);

      if (deleteError) {
        throw deleteError;
      }
    }


    /*
      4. 현재 작품 저장
    */
    for (let slot = 0; slot < (value.works || []).length; slot++) {

      const work = value.works[slot];

      if (!work) continue;


      if (!work.id) {
        work.id = crypto.randomUUID();
      }


      /*
        새 작품이면 Storage에 이미지 업로드
      */
      let imagePath = work.imagePath;


      if (!imagePath && work.blob) {

        imagePath =
          `${user.id}/${value.id}/${work.id}.jpg`;


        const { error: uploadError } =
          await supabaseClient
            .storage
            .from('works')
            .upload(
              imagePath,
              work.blob,
              {
                upsert: true,
                contentType:
                  work.blob.type || 'image/jpeg'
              }
            );

        if (uploadError) {
          throw uploadError;
        }


        work.imagePath = imagePath;
      }


      /*
        작품 정보 저장
      */
      const { error: workError } =
        await supabaseClient
          .from('works')
          .upsert({
            id: work.id,
            exhibition_id: value.id,
            slot,
            name: work.name || '',
            title: work.title || '',
            description: work.description || '',
            image_path: imagePath || '',
            width: work.width || null,
            height: work.height || null
          });


      if (workError) {
        throw workError;
      }
    }


    localStorage.setItem(
      CURRENT_ROOM_KEY,
      value.id
    );
  }


  /* ---------------------------------------------------------
     전시관 목록
     --------------------------------------------------------- */
  async function list() {

    const user = await requireUser();


    const { data: exhibitions, error } =
      await supabaseClient
        .from('exhibitions')
        .select('*')
        .eq('owner_id', user.id)
        .order('updated_at', { ascending: false });


    if (error) {
      throw error;
    }


    if (!exhibitions || exhibitions.length === 0) {
      return [];
    }


    const ids =
      exhibitions.map(exhibition => exhibition.id);


    const { data: works, error: worksError } =
      await supabaseClient
        .from('works')
        .select('exhibition_id')
        .in('exhibition_id', ids);


    if (worksError) {
      throw worksError;
    }


    return exhibitions.map(exhibition => {

      const settings =
        exhibition.settings || {};


      const occupied =
        (works || []).filter(
          work =>
            work.exhibition_id === exhibition.id
        ).length;


      return {
        id: exhibition.id,
        title: exhibition.title,
        theme: exhibition.theme,
        count: Number(settings.count) || 0,
        occupied
      };
    });
  }


  /* ---------------------------------------------------------
     전시관 삭제
     --------------------------------------------------------- */
  async function remove(id) {

    await requireUser();


    /*
      먼저 작품 이미지 경로를 가져옵니다.
    */
    const { data: works, error: worksError } =
      await supabaseClient
        .from('works')
        .select('image_path')
        .eq('exhibition_id', id);


    if (worksError) {
      throw worksError;
    }


    const paths =
      (works || [])
        .map(work => work.image_path)
        .filter(Boolean);


    /*
      Storage 이미지 삭제
    */
    if (paths.length > 0) {

      const { error: storageError } =
        await supabaseClient
          .storage
          .from('works')
          .remove(paths);

      if (storageError) {
        throw storageError;
      }
    }


    /*
      exhibitions를 삭제하면
      works는 cascade로 함께 삭제됩니다.
    */
    const { error } =
      await supabaseClient
        .from('exhibitions')
        .delete()
        .eq('id', id);


    if (error) {
      throw error;
    }


    if (
      localStorage.getItem(CURRENT_ROOM_KEY) === id
    ) {
      localStorage.removeItem(CURRENT_ROOM_KEY);
    }
  }


  return {
    read,
    write,
    list,
    room,
    remove
  };

})();

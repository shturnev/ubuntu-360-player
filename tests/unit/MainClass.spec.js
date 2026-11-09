import {MainModelClass, removeFilesHelper} from '../../src/models/MainModelClass'

const test_data = [
  {
    bigName: '1-259720.png',
    error: null,
    origPath: '/home/shturnev/Изображения/1.png',
    selected: true,
    thumpName: '1-259720.png',
    type: 'image'
  },
  {
    bigName: '2-257153.png',
    error: null,
    origPath: '/home/shturnev/Изображения/2.png',
    selected: true,
    thumpName: '2-257153.png',
    type: 'image'
  }
];

describe('Main Class', () =>{
  let MC = new MainModelClass(null);



  test('delete selected files', () => {
    let res = MC.deleteSelected(test_data);
    expect(res).toBe(true)

  })


  test('count data cache size of static directory', async ()=>{
    // let res = await MC.dataCacheSize();
    // expect(res).not.toBe(0);
    // console.log(res);
  })

  test("test delete files from dir", () => {
    let items = [
        'Ch5UAa90ysU-392034.jpg',
        'Pool-12-09-103808314.jpg',
        'Rb34S_mS9f8-173504.jpg',
        'UY4jDW5uDQQ-485116.jpg',
        'VID_20170123_012841_051-8983748.jpg',
        'VID_20190928_154804_00_099-298536093.jpg',
        'e6boEFrBPYs-346075.jpg',
        'logo-48297.png',
        'unnamed-110638.png',
        'wifi-GkiHwyAq-2406.png'
      ]
    ;
    let res = removeFilesHelper(MC.static_dir + '/small', items);
    expect(res).not.toBe(0);

  })

})



